const express = require("express");
const cors = require("cors");
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const Stripe = require("stripe");
const { MongoClient, ServerApiVersion } = require("mongodb");
const { PRODUCTS, BUNDLES } = require("./products"); 
// ^ Ensure your products.js has the 'file' property we added!

const app = express();
const port = process.env.PORT || 3000;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(cors({ origin: process.env.LIVE_CLIENT_URL }));
app.use(express.json());

// =====================
// MONGODB CONNECTION
// =====================
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.lftgrs4.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

let requestsCollection;
let ordersCollection; // Added collection for orders

async function initMongo() {
  try {
    await client.connect();
    const db = client.db("founderDB");
    requestsCollection = db.collection("callRequests");
    ordersCollection = db.collection("orders"); // Save orders here
    console.log("✅ Connected to MongoDB");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
  }
}
initMongo();

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
      // CRITICAL CHANGE: We pass the session_id back to the success page
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
// 2. VERIFY & GET DOWNLOADS (The New Logic)
// =====================
app.post("/api/verify-session", async (req, res) => {
  const { sessionId } = req.body;

  try {
    // A. Verify with Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items']
    });

    if (session.payment_status === "paid") {
      const customerEmail = session.customer_details.email;

      // B. Save Order to MongoDB (Prevent duplicates)
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
      // We map the Stripe "description" (Product Name) back to our local file
      const downloadLinks = session.line_items.data.map(item => {
        const productInfo = findProductByName(item.description);
        
        if (productInfo && productInfo.file) {
          return {
            name: item.description,
            // Points to our local download route
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
  
  // Security: Prevent directory traversal (users trying to access ../../)
  const safeFilename = path.basename(filename); 
  const filePath = path.join(__dirname, "pdfs", safeFilename);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File missing: ${filePath}`);
    return res.status(404).send("File not found on server.");
  }

  // This forces the browser to download the file instead of opening it
  res.download(filePath, safeFilename, (err) => {
    if (err) console.error("Download Error:", err);
  });
});

// =====================
// HELPER: Match Name to File
// =====================
function findProductByName(name) {
  // Check Bundles first
  const bundle = Object.values(BUNDLES).find(b => b.name === name);
  if (bundle) return bundle;

  // Check Products
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
    await requestsCollection.insertOne({ name, email, goals, createdAt: new Date() });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/", (req, res) => res.send("🚀 Backend is live"));

app.listen(port, () => console.log(`✅ Server running on port ${port}`));

// Export for Vercel
module.exports = app;

// Only listen if run directly (Localhost), not when imported by Vercel
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`✅ Server running on http://localhost:${port}`));
}