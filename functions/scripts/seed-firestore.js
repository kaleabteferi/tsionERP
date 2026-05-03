const admin = require('firebase-admin');

function parseArgs(argv) {
  const args = { overwrite: false, project: '', bucket: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--overwrite') args.overwrite = true;
    if (token === '--project' && argv[i + 1]) args.project = argv[i + 1];
    if (token === '--bucket' && argv[i + 1]) args.bucket = argv[i + 1];
  }
  return args;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = args.project || process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || '';
  const storageBucket = args.bucket || process.env.FIREBASE_STORAGE_BUCKET || '';

  if (!projectId) {
    throw new Error('Missing Firebase project ID. Set FIREBASE_PROJECT_ID or pass --project <id>.');
  }

  admin.initializeApp({
    projectId,
    ...(storageBucket ? { storageBucket } : {})
  });

  const db = admin.firestore();
  const now = new Date().toISOString();

  const company = {
    name: process.env.COMPANY_NAME || 'Tsion Parboiled Brown Rice',
    phone: process.env.COMPANY_PHONE || '+251 94 413 5444',
    address: process.env.COMPANY_ADDRESS || 'Addis Ababa, Ethiopia',
    tin: process.env.COMPANY_TIN || '',
    tagline: process.env.COMPANY_TAGLINE || '100% Natural · Healthy · Gluten Free · Made in Ethiopia',
    updated_at: now
  };

  const currentPrice = {
    price_per_kg: Number(process.env.SEED_PRICE_PER_KG || 85),
    effective_date: process.env.SEED_PRICE_EFFECTIVE_DATE || now.slice(0, 10),
    notes: process.env.SEED_PRICE_NOTES || 'Initial price',
    created_at: now
  };

  const warehouseStock = {
    current_qty: Number(process.env.SEED_STOCK_CURRENT_QTY || 0),
    total_received: Number(process.env.SEED_STOCK_TOTAL_RECEIVED || 0),
    updated_at: now
  };

  const counters = {
    supermarket_code_seq: Number(process.env.SEED_SUPERMARKET_SEQ || 0),
    delivery_fs_seq: Number(process.env.SEED_DELIVERY_SEQ || 0),
    payment_ref_seq: Number(process.env.SEED_PAYMENT_SEQ || 0),
    updated_at: now
  };

  const tasks = [
    { ref: db.collection('settings').doc('company'), data: company },
    { ref: db.collection('settings').doc('current_price'), data: currentPrice },
    { ref: db.collection('settings').doc('warehouse_stock'), data: warehouseStock },
    { ref: db.collection('settings').doc('counters'), data: counters }
  ];

  for (const item of tasks) {
    const existing = await item.ref.get();
    if (existing.exists && !args.overwrite) {
      console.log(`skip ${item.ref.path} (already exists)`);
      continue;
    }
    await item.ref.set(item.data, { merge: true });
    console.log(`seeded ${item.ref.path}`);
  }

  const pricingCollection = db.collection('pricing');
  const pricingCheck = await pricingCollection.limit(1).get();
  if (pricingCheck.empty || args.overwrite) {
    await pricingCollection.doc().set({
      ...currentPrice,
      created_at: now
    });
    console.log('seeded pricing collection with initial price row');
  } else {
    console.log('skip pricing collection (already has data)');
  }

  console.log('Firestore seed completed.');
}

run()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Firestore seed failed:', error.message);
    process.exit(1);
  });
