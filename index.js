const express = require("express");
const cors = require("cors");
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const Stripe = require("stripe");
const { MongoClient, ServerApiVersion } = require("mongodb");
const { PRODUCTS, BUNDLES } = require("./products");

const app = express();
// Note: app.listen is NOT used in Vercel, we export the app instead.

// Initialize Stripe (Check if key exists to prevent crash)
if (!process.env.STRIPE_SECRET_KEY) {
  console.error("CRITICAL: STRIPE_SECRET_KEY is missing in Env Vars");
}
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(cors({
  origin: ["https://founders-academy-front.vercel.app", "http://localhost:5173", "http://localhost:8080"],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.options("*", cors());
app.use(express.json());

// =====================
// MONGODB CONNECTION (Serverless Optimized)
// =====================
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.lftgrs4.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
  // These options help prevent timeouts in serverless
  connectTimeoutMS: 10000, 
  socketTimeoutMS: 45000,
});

let requestsCollection;
let ordersCollection;

// We use a cached promise to ensure we don't connect multiple times in the same warm instance
let clientPromise;

async function getDB() {
  if (!clientPromise) {
    clientPromise = client.connect();
  }
  await clientPromise;
  const db = client.db("founderDB");
  requestsCollection = db.collection("callRequests");
  ordersCollection = db.collection("orders");
  return db;
}

// =====================
// 1. STRIPE CHECKOUT
// =====================
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { items = [], bundleId, email } = req.body;
    let line_items = [];

    // Bundle Logic
    if (bundleId && BUNDLES[bundleId]) {
      const bundle = BUNDLES[bundleId];
      line_items.push({
        price_data: {
          currency: "gbp",
          product_data: { name: bundle.name },
          unit_amount: Math.round(bundle.price * 100),
        },
        quantity: 1,
      });
    }
    // Individual Items Logic
    else {
      const uniqueIds = [...new Set(items.map((i) => i.id))];
      uniqueIds.forEach((id) => {
        const product = PRODUCTS[id];
        if (product) {
          line_items.push({
            price_data: {
              currency: "gbp",
              product_data: { name: product.name },
              unit_amount: Math.round(product.price * 100),
            },
            quantity: 1,
          });
        }
      });
    }

    if (!line_items.length) return res.status(400).json({ error: "No valid items" });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items,
      customer_email: email,
      success_url: `${process.env.LIVE_CLIENT_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.LIVE_CLIENT_URL}/cart`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe Session Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// =====================
// 2. VERIFY & GET DOWNLOADS
// =====================
app.post("/api/verify-session", async (req, res) => {
  const { sessionId } = req.body;

  try {
    // Ensure DB is connected before trying to use it
    await getDB();

    // A. Verify with Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items']
    });

    if (session.payment_status === "paid") {
      const customerEmail = session.customer_details.email;

      // B. Save Order to MongoDB
      const existingOrder = await ordersCollection.findOne({ orderId: session.id });

      if (!existingOrder) {
        await ordersCollection.insertOne({
          orderId: session.id,
          email: customerEmail,
          amount: session.amount_total / 100,
          items: session.line_items.data.map(i => i.description),
          createdAt: new Date()
        });
        console.log(`✅ Order saved for ${customerEmail}`);
      }

      // C. Generate Download Links
      const downloadLinks = session.line_items.data.map(item => {
        const productInfo = findProductByName(item.description);

        if (productInfo && productInfo.file) {
          return {
            name: item.description,
            downloadUrl: `${process.env.LIVE_CLIENT_URL}/download/${productInfo.file}`
          };
        }
        return null;
      }).filter(Boolean);

      return res.json({ success: true, items: downloadLinks });
    }

    res.status(400).json({ success: false, message: "Payment not verified" });

  } catch (err) {
    console.error("Verification Error:", err);
    res.status(500).json({ error: "Server verification failed" });
  }
});

// =====================
// 3. FILE DOWNLOAD ROUTE
// =====================
app.get("/download/:filename", (req, res) => {
  const { filename } = req.params;
  const safeFilename = path.basename(filename);
  
  // Vercel specific: Ensure we look in the right place relative to execution
  const filePath = path.join(__dirname, "pdfs", safeFilename);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File missing at path: ${filePath}`);
    return res.status(404).send("File not found. Please contact support.");
  }

  res.download(filePath, safeFilename, (err) => {
    if (err) console.error("Download Error:", err);
  });
});

// =====================
// HELPER: Match Name to File
// =====================
function findProductByName(name) {
  const bundle = Object.values(BUNDLES).find(b => b.name === name);
  if (bundle) return bundle;

  const product = Object.values(PRODUCTS).find(p => p.name === name);
  if (product) return product;

  return null;
}

// =====================
// OTHER ROUTES
// =====================
app.post("/api/request-call", async (req, res) => {
  const { name, email, goals } = req.body;
  if (!name || !email || !goals) return res.status(400).json({ message: "Fields missing" });

  try {
    await getDB(); // Ensure connection
    await requestsCollection.insertOne({ name, email, goals, createdAt: new Date() });
    res.json({ success: true });
  } catch (err) {
    console.error("DB Error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/", (req, res) => res.send("🚀 Backend is live"));

// Export the app for Vercel
module.exports = app;