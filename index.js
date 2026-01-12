const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const Stripe = require("stripe");
const { MongoClient, ServerApiVersion } = require("mongodb");
const { PRODUCTS, BUNDLES } = require("./products");

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ==========================================
// 1. CONFIGURATION
// ==========================================
// Allow your Frontend URL here
const allowedOrigins = [
  "http://localhost:5173",
  "https://founders-academy-front.vercel.app"
];

// Determine URLs for Redirects (Frontend) vs Downloads (Backend)
// On Vercel, ensure these are set in the Settings -> Environment Variables
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;

// ==========================================
// 2. CORS MIDDLEWARE (Vercel Fixed)
// ==========================================
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log("Blocked by CORS:", origin);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
// Handle OPTIONS preflight explicitly to prevent 401s
// app.options("*", cors(corsOptions));
app.options("(.*)", cors(corsOptions));

app.use(express.json());

// ==========================================
// 3. MONGODB CONNECTION (Cached)
// ==========================================
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.lftgrs4.mongodb.net/?retryWrites=true&w=majority`;

let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }
  const client = new MongoClient(uri, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
  });
  await client.connect();
  const db = client.db("founderDB");
  cachedClient = client;
  cachedDb = db;
  console.log("✅ MongoDB Connected");
  return { client, db };
}

// ==========================================
// 4. STRIPE CHECKOUT
// ==========================================
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { items = [], bundleId, email } = req.body;
    let line_items = [];

    // Helper to format price
    const createLineItem = (name, price) => ({
      price_data: {
        currency: "gbp",
        product_data: { name },
        unit_amount: Math.round(price * 100),
      },
      quantity: 1,
    });

    if (bundleId && BUNDLES[bundleId]) {
      line_items.push(createLineItem(BUNDLES[bundleId].name, BUNDLES[bundleId].price));
    } else if (items.length > 0) {
      const uniqueIds = [...new Set(items.map((i) => i.id))];
      uniqueIds.forEach((id) => {
        const product = PRODUCTS[id];
        if (product) line_items.push(createLineItem(product.name, product.price));
      });
    }

    if (!line_items.length) return res.status(400).json({ error: "No items selected" });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items,
      customer_email: email,
      // Redirect to FRONTEND after payment
      success_url: `${FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/cart`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 5. VERIFY PAYMENT & DELIVER DOWNLOADS
// ==========================================
app.post("/api/verify-session", async (req, res) => {
  const { sessionId } = req.body;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items'] });

    if (session.payment_status === "paid") {
      const { db } = await connectToDatabase();
      const ordersCollection = db.collection("orders");

      const existingOrder = await ordersCollection.findOne({ orderId: session.id });
      if (!existingOrder) {
        await ordersCollection.insertOne({
          orderId: session.id,
          email: session.customer_details.email,
          amount: session.amount_total / 100,
          items: session.line_items.data.map(i => i.description),
          createdAt: new Date()
        });
      }

      const downloadLinks = session.line_items.data.map(item => {
        const productInfo = findProductByName(item.description);
        if (productInfo && productInfo.file) {
          return {
            name: item.description,
            // Point to BACKEND for the actual file
            downloadUrl: `${BACKEND_URL}/download/${productInfo.file}`
          };
        }
        return null;
      }).filter(Boolean);

      return res.json({ success: true, items: downloadLinks });
    }
    res.status(400).json({ success: false, message: "Payment not verified" });
  } catch (err) {
    console.error("Verify Error:", err);
    res.status(500).json({ error: "Verification failed" });
  }
});

// ==========================================
// 6. DOWNLOAD ROUTE
// ==========================================
app.get("/download/:filename", (req, res) => {
  const { filename } = req.params;
  const safeFilename = path.basename(filename);
  const filePath = path.join(__dirname, "pdfs", safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found.");
  }
  res.download(filePath, safeFilename, (err) => {
    if (err) console.error("Download Error:", err);
  });
});

// ==========================================
// 7. REQUEST CALL
// ==========================================
app.post("/api/request-call", async (req, res) => {
  const { name, email, goals } = req.body;
  if (!name || !email || !goals) return res.status(400).json({ message: "Missing fields" });

  try {
    const { db } = await connectToDatabase();
    await db.collection("callRequests").insertOne({ name, email, goals, createdAt: new Date() });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Database error" });
  }
});

// ==========================================
// HELPERS
// ==========================================
function findProductByName(name) {
  const bundle = Object.values(BUNDLES).find(b => b.name === name);
  if (bundle) return bundle;
  const product = Object.values(PRODUCTS).find(p => p.name === name);
  if (product) return product;
  return null;
}

app.get("/", (req, res) => res.send("🚀 Backend is live"));

module.exports = app;

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`✅ Server running on port ${port}`));
}