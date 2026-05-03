const router = require('express').Router();
const db     = require('../db');

// GET dashboard summary
router.get('/dashboard', async (req, res, next) => {
  try {
    const [stock, receivables, sales, topSMs, dormant] = await Promise.all([
      db.query(`SELECT current_qty, total_received FROM warehouse_stock LIMIT 1`),
      db.query(`SELECT COALESCE(SUM(outstanding),0) AS total, COUNT(*) FILTER (WHERE outstanding > credit_limit) AS over_limit, COUNT(*) FILTER (WHERE outstanding > credit_limit * 0.8 AND outstanding <= credit_limit) AS near_limit FROM supermarkets WHERE status='Active'`),
      db.query(`SELECT COALESCE(SUM(sr.qty_sold),0) AS total_kg, COALESCE(SUM(sr.total_value),0) AS total_revenue FROM sales_reports sr`),
      db.query(`SELECT s.name, s.id, COALESCE(SUM(sr.qty_sold),0) AS total_sold, COALESCE(SUM(sr.total_value),0) AS revenue FROM supermarkets s LEFT JOIN sales_reports sr ON sr.supermarket_id = s.id GROUP BY s.id, s.name ORDER BY total_sold DESC LIMIT 5`),
      db.query(`SELECT s.name, s.id, MAX(d.delivery_date) AS last_delivery, EXTRACT(DAY FROM NOW() - MAX(d.delivery_date)) AS days_since FROM supermarkets s LEFT JOIN deliveries d ON d.supermarket_id = s.id WHERE s.status='Active' GROUP BY s.id, s.name HAVING MAX(d.delivery_date) IS NULL OR EXTRACT(DAY FROM NOW() - MAX(d.delivery_date)) > 30 ORDER BY days_since DESC NULLS FIRST`),
    ]);

    res.json({
      warehouse:   stock.rows[0],
      receivables: receivables.rows[0],
      sales:       sales.rows[0],
      top_supermarkets: topSMs.rows,
      dormant_supermarkets: dormant.rows,
    });
  } catch (err) { next(err); }
});

// GET aging report
router.get('/aging', async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT s.name, s.code, s.outstanding, s.credit_limit,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.supermarket_id = s.id AND p.payment_date >= NOW() - INTERVAL '7 days'),0) AS paid_last_7,
        COALESCE((SELECT MAX(p.payment_date) FROM payments p WHERE p.supermarket_id = s.id), NULL) AS last_payment_date,
        COALESCE((SELECT MAX(d.delivery_date) FROM deliveries d WHERE d.supermarket_id = s.id), NULL) AS last_delivery_date
      FROM supermarkets s WHERE s.status = 'Active'
      ORDER BY s.outstanding DESC
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

// GET sales trend (daily/weekly/monthly)
router.get('/sales-trend', async (req, res, next) => {
  try {
    const { period = 'monthly' } = req.query;
    const trunc = period === 'daily' ? 'day' : period === 'weekly' ? 'week' : 'month';
    const { rows } = await db.query(`
      SELECT DATE_TRUNC($1, sr.report_date) AS period,
             SUM(sr.qty_sold) AS qty_sold,
             SUM(sr.total_value) AS revenue,
             COUNT(DISTINCT sr.supermarket_id) AS active_supermarkets
      FROM sales_reports sr
      GROUP BY DATE_TRUNC($1, sr.report_date)
      ORDER BY period DESC
      LIMIT 12
    `, [trunc]);
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
