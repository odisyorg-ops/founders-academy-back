// products.js

const PRODUCTS = {
  // === MAIN SALES SERIES ===
  "ebook-sdr": { 
    name: "SDR Success Playbook", 
    price: 69, 
    file: "sdr-success-playbook.pdf" // Must match the filename in your /pdfs folder
  },
  "ebook-bdm": { 
    name: "Business Development Playbook", 
    price: 69, 
    file: "bdm-playbook.pdf" 
  },
  "ebook-am": { 
    name: "Account Manager Playbook", 
    price: 69, 
    file: "am-playbook.pdf" 
  },

  // === SALES TRAINING ===
  "ebook-cold-calls": { 
    name: "Mastering Cold Calls – Full Guide", 
    price: 29, 
    file: "mastering-cold-calls.pdf" 
  },

  // === COACHING ===
  "ebook-coaching": { 
    name: "Unlocking Your Potential – Coaching Guide", 
    price: 29, 
    file: "coaching-guide.pdf" 
  },

  // === FITNESS ===
  "ebook-fitness": { 
    name: "Revitalise Your Life – Full Guide", 
    price: 29, 
    file: "fitness-guide.pdf" 
  },

  // === RECRUITMENT ===
  "ebook-recruitment": { 
    name: "Building Your Personal Brand – Full Guide", 
    price: 29, 
    file: "building-your-personal-brand-a-recruitment-advantage Full paid.pdf" 
  },
};

// === BUNDLES ===
const BUNDLES = {
  "sales-series": {
    name: "Sales Excellence Series (3 Books)",
    price: 109,
    items: ["ebook-sdr", "ebook-bdm", "ebook-am"],
    file: "sales-excellence-series.zip" // Create a ZIP containing the 3 PDFs above
  },
  "complete-bundle": {
    name: "Complete Resource Bundle (7 Books)",
    price: 171,
    items: Object.keys(PRODUCTS),
    file: "complete-resource-bundle.zip" // Create a ZIP containing all 7 PDFs
  },
};

module.exports = { PRODUCTS, BUNDLES };