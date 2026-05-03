const db = require('./index');
require('dotenv').config();

async function seed() {
  console.log('Seeding database...\n');

  // Pricing
  await db.query(`
    INSERT INTO pricing (price_per_kg, effective_date, notes)
    VALUES (85, '2024-01-01', 'Initial price')
    ON CONFLICT DO NOTHING
  `);
  console.log('✓ Pricing seeded');

  // Warehouse stock
  await db.query(`
    UPDATE warehouse_stock SET current_qty = 1200, total_received = 5000
  `);
  await db.query(`
    INSERT INTO inventory_transactions (ref, type, qty, note, transaction_date)
    VALUES
      ('INV-001', 'stock_in', 2000, 'Initial stock', '2024-10-01'),
      ('INV-002', 'stock_in', 1500, 'Restock batch 2', '2024-11-15'),
      ('INV-003', 'stock_in', 1500, 'Restock batch 3', '2025-01-10')
    ON CONFLICT DO NOTHING
  `);
  console.log('✓ Inventory seeded');

  // Supermarkets
  const sms = [
    { code: 'SM001', name: 'Shoa Supermarket', branch: 'Main Branch', tin: 'R00123456', contact: 'Abebe Girma', phone: '+251911234567', email: 'shoa@example.com', address: 'Bole Road, Addis Ababa', lat: 9.0227, lng: 38.7882, credit_limit: 50000, outstanding: 12500 },
    { code: 'SM002', name: 'Fantu Supermarket', branch: 'Piazza Branch', tin: 'R00234567', contact: 'Tigist Haile', phone: '+251922345678', email: 'fantu@example.com', address: 'Piazza, Addis Ababa', lat: 9.0400, lng: 38.7500, credit_limit: 30000, outstanding: 28000 },
    { code: 'SM003', name: 'Bambis Supermarket', branch: 'Gerji Branch', tin: 'R00345678', contact: 'Dawit Bekele', phone: '+251933456789', email: 'bambis@example.com', address: 'Gerji, Addis Ababa', lat: 9.0150, lng: 38.8100, credit_limit: 40000, outstanding: 5000 },
    { code: 'SM004', name: 'Kera Market', branch: 'Kera', tin: 'R00456789', contact: 'Meron Tadesse', phone: '+251944567890', email: 'kera@example.com', address: 'Kera, Addis Ababa', lat: 8.9900, lng: 38.7600, credit_limit: 20000, outstanding: 19500, status: 'Inactive' },
  ];

  const smIds = {};
  for (const sm of sms) {
    const res = await db.query(`
      INSERT INTO supermarkets (code, name, branch, tin, contact_name, phone, email, address, lat, lng, credit_limit, outstanding, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name
      RETURNING id
    `, [sm.code, sm.name, sm.branch, sm.tin, sm.contact, sm.phone, sm.email, sm.address, sm.lat, sm.lng, sm.credit_limit, sm.outstanding, sm.status || 'Active']);
    smIds[sm.code] = res.rows[0].id;
  }
  console.log('✓ Supermarkets seeded');

  // Deliveries
  const deliveries = [
    { fs: 'FS-0001', code: 'SM001', qty: 200, sold: 180, ret: 0, date: '2025-03-01' },
    { fs: 'FS-0002', code: 'SM002', qty: 150, sold: 100, ret: 0, date: '2025-03-05' },
    { fs: 'FS-0003', code: 'SM003', qty: 100, sold: 95,  ret: 5, date: '2025-03-10' },
    { fs: 'FS-0004', code: 'SM001', qty: 300, sold: 250, ret: 0, date: '2025-04-01' },
    { fs: 'FS-0005', code: 'SM002', qty: 200, sold: 140, ret: 0, date: '2025-04-10' },
    { fs: 'FS-0006', code: 'SM004', qty: 100, sold: 60,  ret: 0, date: '2025-02-01' },
  ];
  for (const d of deliveries) {
    await db.query(`
      INSERT INTO deliveries (fs_number, supermarket_id, qty_delivered, qty_sold, qty_returned, delivery_date, status)
      VALUES ($1,$2,$3,$4,$5,$6,'Delivered')
      ON CONFLICT (fs_number) DO NOTHING
    `, [d.fs, smIds[d.code], d.qty, d.sold, d.ret, d.date]);
  }
  console.log('✓ Deliveries seeded');

  // Payments
  const payments = [
    { ref: 'PAY-001', code: 'SM001', amount: 10000, date: '2025-03-15', method: 'Bank Transfer' },
    { ref: 'PAY-002', code: 'SM002', amount: 5000,  date: '2025-03-20', method: 'Cash' },
    { ref: 'PAY-003', code: 'SM003', amount: 8000,  date: '2025-04-01', method: 'Bank Transfer' },
  ];
  for (const p of payments) {
    await db.query(`
      INSERT INTO payments (ref, supermarket_id, amount, payment_date, method)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (ref) DO NOTHING
    `, [p.ref, smIds[p.code], p.amount, p.date, p.method]);
  }
  console.log('✓ Payments seeded');

  console.log('\n✅ Seeding complete!\n');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seeding failed:', err.message);
  process.exit(1);
});
