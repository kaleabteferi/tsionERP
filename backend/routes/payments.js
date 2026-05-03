const router = require('express').Router();
const db     = require('../db');

// GET all payments
router.get('/', async (req, res, next) => {
  try {
    const { supermarket_id } = req.query;
    let q = `
      SELECT p.*, s.name AS supermarket_name, s.code AS supermarket_code
      FROM payments p JOIN supermarkets s ON s.id = p.supermarket_id
      WHERE 1=1
    `;
    const params = [];
    if (supermarket_id) { params.push(supermarket_id); q += ` AND p.supermarket_id = $${params.length}`; }
    q += ` ORDER BY p.payment_date DESC, p.created_at DESC`;
    const { rows } = await db.query(q, params);
    res.json(rows);
  } catch (err) { next(err); }
});

// POST record payment
router.post('/', async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { supermarket_id, amount, payment_date, method, reference_no, notes } = req.body;
    const amountNum = Number(amount);
    if (!supermarket_id || !Number.isFinite(amountNum) || amountNum <= 0)
      return res.status(400).json({ error: 'supermarket_id and amount are required' });

    const { rows: [supermarket] } = await client.query(
      `SELECT id, outstanding FROM supermarkets WHERE id = $1 FOR UPDATE`,
      [supermarket_id]
    );
    if (!supermarket) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Supermarket not found' });
    }

    const outstanding = Number(supermarket.outstanding || 0);
    if (outstanding <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No outstanding balance for this supermarket' });
    }
    if (amountNum > outstanding) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Payment exceeds outstanding balance (${outstanding.toFixed(2)})`
      });
    }

    // Generate ref
    const { rows: [last] } = await client.query(`
      SELECT COALESCE(MAX(CAST(REGEXP_REPLACE(ref, '\\D', '', 'g') AS INTEGER)), 0) AS max_num
      FROM payments
      WHERE ref ~ '[0-9]'
    `);
    const lastNum = Number(last?.max_num || 0);
    const ref = 'PAY-' + String(lastNum + 1).padStart(3, '0');

    const { rows } = await client.query(`
      INSERT INTO payments (ref, supermarket_id, amount, payment_date, method, reference_no, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [ref, supermarket_id, amountNum, payment_date || new Date().toISOString().slice(0,10), method || 'Bank Transfer', reference_no || null, notes || null]);

    // Reduce outstanding balance
    await client.query(`
      UPDATE supermarkets SET outstanding = outstanding - $1 WHERE id = $2
    `, [amountNum, supermarket_id]);

    await client.query('COMMIT');
    const { rows: [full] } = await db.query(`
      SELECT p.*, s.name AS supermarket_name FROM payments p
      JOIN supermarkets s ON s.id = p.supermarket_id WHERE p.id = $1
    `, [rows[0].id]);
    res.status(201).json(full);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

module.exports = router;
