const router = require('express').Router();
const db     = require('../db');

// GET warehouse stock summary
router.get('/summary', async (req, res, next) => {
  try {
    const { rows: [stock] } = await db.query(`SELECT * FROM warehouse_stock LIMIT 1`);
    const { rows: [dist] } = await db.query(`
      SELECT COALESCE(SUM(qty_delivered),0) AS total_distributed,
             COALESCE(SUM(qty_balance),0)   AS at_supermarkets,
             COALESCE(SUM(qty_returned),0)  AS total_returned
      FROM deliveries
    `);
    res.json({ ...stock, ...dist });
  } catch (err) { next(err); }
});

// GET transaction history
router.get('/transactions', async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT * FROM inventory_transactions ORDER BY transaction_date DESC, created_at DESC
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

// POST stock in
router.post('/stock-in', async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { qty, note, transaction_date } = req.body;
    if (!qty || qty <= 0) return res.status(400).json({ error: 'Invalid quantity' });

    const ref = 'INV-' + Date.now();
    await client.query(`
      INSERT INTO inventory_transactions (ref, type, qty, note, transaction_date)
      VALUES ($1, 'stock_in', $2, $3, $4)
    `, [ref, qty, note || '', transaction_date || new Date().toISOString().slice(0,10)]);

    await client.query(`
      UPDATE warehouse_stock SET
        current_qty = current_qty + $1,
        total_received = total_received + $1,
        updated_at = NOW()
    `, [qty]);

    await client.query('COMMIT');
    const { rows: [stock] } = await client.query(`SELECT * FROM warehouse_stock LIMIT 1`);
    res.status(201).json({ success: true, ref, stock });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

// GET current price
router.get('/price', async (req, res, next) => {
  try {
    const { rows } = await db.query(`SELECT * FROM pricing ORDER BY effective_date DESC LIMIT 1`);
    res.json(rows[0] || { price_per_kg: 85 });
  } catch (err) { next(err); }
});

// POST update price
router.post('/price', async (req, res, next) => {
  try {
    const { price_per_kg, effective_date, notes } = req.body;
    if (!price_per_kg || price_per_kg <= 0) return res.status(400).json({ error: 'Invalid price' });
    const { rows } = await db.query(`
      INSERT INTO pricing (price_per_kg, effective_date, notes)
      VALUES ($1, $2, $3) RETURNING *
    `, [price_per_kg, effective_date || new Date().toISOString().slice(0,10), notes || '']);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
