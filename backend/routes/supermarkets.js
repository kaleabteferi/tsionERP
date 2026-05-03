const router = require('express').Router();
const db     = require('../db');

// GET all supermarkets
router.get('/', async (req, res, next) => {
  try {
    const { status, search } = req.query;
    let q = `
      SELECT s.*,
        COALESCE((
          SELECT SUM(d.qty_delivered - d.qty_sold - d.qty_returned)
          FROM deliveries d WHERE d.supermarket_id = s.id
        ), 0) AS consignment_stock
      FROM supermarkets s WHERE 1=1
    `;
    const params = [];
    if (status) { params.push(status); q += ` AND s.status = $${params.length}`; }
    if (search) { params.push(`%${search}%`); q += ` AND (s.name ILIKE $${params.length} OR s.branch ILIKE $${params.length} OR s.address ILIKE $${params.length})`; }
    q += ` ORDER BY s.created_at DESC, s.name ASC`;
    const { rows } = await db.query(q, params);
    res.json(rows);
  } catch (err) { next(err); }
});

// GET single supermarket with full history
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await db.query(`SELECT * FROM supermarkets WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const sm = rows[0];

    const { rows: deliveries } = await db.query(
      `SELECT d.*, (d.qty_delivered - d.qty_sold - d.qty_returned) AS balance
       FROM deliveries d WHERE d.supermarket_id = $1 ORDER BY d.delivery_date DESC`, [sm.id]
    );
    const { rows: payments } = await db.query(
      `SELECT * FROM payments WHERE supermarket_id = $1 ORDER BY payment_date DESC`, [sm.id]
    );

    res.json({ ...sm, deliveries, payments });
  } catch (err) { next(err); }
});

// POST create supermarket
router.post('/', async (req, res, next) => {
  try {
    const { name, branch, tin, contact_name, phone, email, address, lat, lng, credit_limit, status, payment_terms } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    // Auto-generate code
    const { rows: last } = await db.query(`SELECT code FROM supermarkets ORDER BY created_at DESC LIMIT 1`);
    const lastNum = last.length ? parseInt(last[0].code.replace('SM','')) : 0;
    const code = 'SM' + String(lastNum + 1).padStart(3, '0');

    const { rows } = await db.query(`
      INSERT INTO supermarkets (code, name, branch, tin, contact_name, phone, email, address, lat, lng, credit_limit, status, payment_terms)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *
    `, [code, name, branch, tin, contact_name, phone, email, address, lat || null, lng || null, credit_limit || 20000, status || 'Active', payment_terms || 'Consignment']);

    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// PUT update supermarket
router.put('/:id', async (req, res, next) => {
  try {
    const { name, branch, tin, contact_name, phone, email, address, lat, lng, credit_limit, status } = req.body;
    const { rows } = await db.query(`
      UPDATE supermarkets SET
        name=$1, branch=$2, tin=$3, contact_name=$4, phone=$5, email=$6,
        address=$7, lat=$8, lng=$9, credit_limit=$10, status=$11
      WHERE id=$12 RETURNING *
    `, [name, branch, tin, contact_name, phone, email, address, lat || null, lng || null, credit_limit, status, req.params.id]);

    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// DELETE supermarket
router.delete('/:id', async (req, res, next) => {
  try {
    await db.query(`DELETE FROM supermarkets WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
