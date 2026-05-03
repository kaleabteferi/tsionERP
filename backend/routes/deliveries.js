const router = require('express').Router();
const db     = require('../db');

// GET all deliveries (with supermarket name)
router.get('/', async (req, res, next) => {
  try {
    const { supermarket_id, status } = req.query;
    let q = `
      SELECT d.*, s.name AS supermarket_name, s.branch AS supermarket_branch,
             s.code AS supermarket_code
      FROM deliveries d
      JOIN supermarkets s ON s.id = d.supermarket_id
      WHERE 1=1
    `;
    const params = [];
    if (supermarket_id) { params.push(supermarket_id); q += ` AND d.supermarket_id = $${params.length}`; }
    if (status)         { params.push(status);         q += ` AND d.status = $${params.length}`; }
    q += ` ORDER BY d.delivery_date DESC, d.created_at DESC`;
    const { rows } = await db.query(q, params);
    res.json(rows);
  } catch (err) { next(err); }
});

// GET single delivery
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT d.*, s.name AS supermarket_name, s.branch AS supermarket_branch,
             s.address AS supermarket_address, s.contact_name, s.phone AS supermarket_phone, s.tin AS supermarket_tin
      FROM deliveries d JOIN supermarkets s ON s.id = d.supermarket_id
      WHERE d.id = $1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// POST create delivery
router.post('/', async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { supermarket_id, qty_delivered, delivery_date, driver, notes } = req.body;

    if (!supermarket_id || !qty_delivered || qty_delivered <= 0)
      return res.status(400).json({ error: 'supermarket_id and qty_delivered are required' });

    // Check warehouse stock
    const { rows: [stock] } = await client.query(`SELECT current_qty FROM warehouse_stock LIMIT 1`);
    if (parseFloat(stock.current_qty) < parseFloat(qty_delivered))
      return res.status(400).json({ error: `Insufficient warehouse stock. Available: ${stock.current_qty} KG` });

    // Generate FS number
    const { rows: [last] } = await client.query(`SELECT fs_number FROM deliveries ORDER BY created_at DESC LIMIT 1`);
    const lastNum = last ? parseInt(last.fs_number.replace('FS-','')) : 0;
    const fs_number = 'FS-' + String(lastNum + 1).padStart(4, '0');

    // Create delivery
    const { rows } = await client.query(`
      INSERT INTO deliveries (fs_number, supermarket_id, qty_delivered, delivery_date, driver, notes, status)
      VALUES ($1,$2,$3,$4,$5,$6,'Delivered') RETURNING *
    `, [fs_number, supermarket_id, qty_delivered, delivery_date || new Date().toISOString().slice(0,10), driver || null, notes || null]);

    // Deduct from warehouse
    const ref = 'INV-' + Date.now();
    await client.query(`
      INSERT INTO inventory_transactions (ref, type, qty, note, delivery_id, transaction_date)
      VALUES ($1,'stock_out',$2,$3,$4,$5)
    `, [ref, qty_delivered, `Delivery ${fs_number}`, rows[0].id, delivery_date || new Date().toISOString().slice(0,10)]);

    await client.query(`
      UPDATE warehouse_stock SET current_qty = current_qty - $1, updated_at = NOW()
    `, [qty_delivered]);

    await client.query('COMMIT');

    // Return full delivery with supermarket info
    const { rows: [full] } = await db.query(`
      SELECT d.*, s.name AS supermarket_name, s.branch AS supermarket_branch
      FROM deliveries d JOIN supermarkets s ON s.id = d.supermarket_id
      WHERE d.id = $1
    `, [rows[0].id]);

    res.status(201).json(full);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

// PATCH report sales for a delivery
router.patch('/:id/sales', async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { qty_sold, qty_returned, notes } = req.body;

    // Get delivery + current price
    const { rows: [d] } = await client.query(`SELECT * FROM deliveries WHERE id = $1`, [req.params.id]);
    if (!d) return res.status(404).json({ error: 'Delivery not found' });

    const total = parseFloat(qty_sold || 0) + parseFloat(qty_returned || 0);
    if (total > parseFloat(d.qty_delivered))
      return res.status(400).json({ error: 'Sold + returned cannot exceed delivered quantity' });

    const { rows: [price] } = await client.query(`SELECT price_per_kg FROM pricing ORDER BY effective_date DESC LIMIT 1`);
    const pricePerKg = parseFloat(price?.price_per_kg || 85);

    const additionalSold = parseFloat(qty_sold || 0) - parseFloat(d.qty_sold || 0);
    const additionalReturned = parseFloat(qty_returned || 0) - parseFloat(d.qty_returned || 0);

    // Update delivery
    await client.query(`
      UPDATE deliveries SET qty_sold=$1, qty_returned=$2, updated_at=NOW()
      WHERE id=$3
    `, [qty_sold || 0, qty_returned || 0, d.id]);

    // Log sales report if new sales
    if (additionalSold > 0) {
      await client.query(`
        INSERT INTO sales_reports (delivery_id, supermarket_id, qty_sold, price_per_kg, report_date, notes)
        VALUES ($1,$2,$3,$4,NOW(),$5)
      `, [d.id, d.supermarket_id, additionalSold, pricePerKg, notes || null]);

      // Update supermarket outstanding balance
      const revenue = additionalSold * pricePerKg;
      await client.query(`
        UPDATE supermarkets SET outstanding = outstanding + $1 WHERE id = $2
      `, [revenue, d.supermarket_id]);
    }

    // Return stock to warehouse if new returns
    if (additionalReturned > 0) {
      const ref = 'RET-' + Date.now();
      await client.query(`
        INSERT INTO inventory_transactions (ref, type, qty, note, delivery_id, transaction_date)
        VALUES ($1,'return',$2,$3,$4,NOW())
      `, [ref, additionalReturned, `Return from delivery ${d.fs_number}`, d.id]);
      await client.query(`
        UPDATE warehouse_stock SET current_qty = current_qty + $1, updated_at = NOW()
      `, [additionalReturned]);
    }

    await client.query('COMMIT');
    const { rows: [updated] } = await db.query(`
      SELECT d.*, s.name AS supermarket_name FROM deliveries d
      JOIN supermarkets s ON s.id = d.supermarket_id WHERE d.id = $1
    `, [d.id]);
    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

module.exports = router;
