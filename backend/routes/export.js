const router   = require('express').Router();
const db       = require('../db');
const ExcelJS  = require('exceljs');
const { saveBuffer } = require('../lib/fileStore');

const BRAND   = 'FF8B1A1A';
const BRAND_L = 'FFFDF5F5';

async function persistAndSendWorkbook(res, workbook, filename) {
  const rawBuffer = await workbook.xlsx.writeBuffer();
  const buffer = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer);
  await saveBuffer(`generated_pdfs/${filename}`, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
  res.setHeader('Content-Length', String(buffer.length));
  res.send(buffer);
}

function applyHeaderStyle(cell) {
  cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
  cell.font   = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  cell.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
  cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
}

function autoWidth(sheet) {
  sheet.columns.forEach(col => {
    let max = col.header ? String(col.header).length : 10;
    col.eachCell({ includeEmpty: false }, cell => {
      const val = cell.value !== null && cell.value !== undefined ? String(cell.value) : '';
      if (val.length > max) max = val.length;
    });
    col.width = Math.min(max + 4, 45);
  });
}

// ── Supermarkets export ─────────────────────
router.get('/supermarkets', async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT s.code, s.name, s.branch, s.tin, s.contact_name, s.phone, s.email,
             s.address, s.credit_limit, s.outstanding, s.status, s.payment_terms, s.created_at,
             COALESCE((SELECT SUM(qty_delivered-qty_sold-qty_returned) FROM deliveries d WHERE d.supermarket_id=s.id),0) AS consignment_stock
      FROM supermarkets s ORDER BY s.name
    `);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Tsion ERP';
    const ws = wb.addWorksheet('Supermarkets');

    ws.columns = [
      { header: 'Code',             key: 'code' },
      { header: 'Name',             key: 'name' },
      { header: 'Branch',           key: 'branch' },
      { header: 'TIN',              key: 'tin' },
      { header: 'Contact',          key: 'contact_name' },
      { header: 'Phone',            key: 'phone' },
      { header: 'Email',            key: 'email' },
      { header: 'Address',          key: 'address' },
      { header: 'Credit Limit',     key: 'credit_limit', style: { numFmt: '#,##0.00' } },
      { header: 'Outstanding (ETB)', key: 'outstanding', style: { numFmt: '#,##0.00' } },
      { header: 'Consignment Stock (KG)', key: 'consignment_stock', style: { numFmt: '#,##0' } },
      { header: 'Status',           key: 'status' },
      { header: 'Payment Terms',    key: 'payment_terms' },
      { header: 'Created At',       key: 'created_at' },
    ];

    ws.getRow(1).eachCell(applyHeaderStyle);
    ws.getRow(1).height = 22;

    rows.forEach((r, i) => {
      const row = ws.addRow(r);
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i % 2 === 0 ? 'FFFFFFFF' : 'FFFFF8F8' } };
      // Color-code status
      const statusCell = row.getCell('status');
      statusCell.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: r.status === 'Active' ? 'FFE8F5E9' : 'FFFFF3E0' }
      };
    });

    autoWidth(ws);
    ws.getRow(1).height = 22;

    const filename = `tsion-supermarkets-${Date.now()}.xlsx`;
    await persistAndSendWorkbook(res, wb, filename);
  } catch (err) { next(err); }
});

// ── Deliveries export ───────────────────────
router.get('/deliveries', async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT d.fs_number, s.name AS supermarket, s.branch, d.qty_delivered, d.qty_sold,
             d.qty_returned, d.qty_balance, d.delivery_date, d.status, d.driver,
             p.price_per_kg, (d.qty_sold * p.price_per_kg) AS revenue
      FROM deliveries d
      JOIN supermarkets s ON s.id = d.supermarket_id
      LEFT JOIN LATERAL (SELECT price_per_kg FROM pricing ORDER BY effective_date DESC LIMIT 1) p ON true
      ORDER BY d.delivery_date DESC
    `);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Tsion ERP';
    const ws = wb.addWorksheet('Deliveries');

    ws.columns = [
      { header: 'FS Number',       key: 'fs_number' },
      { header: 'Supermarket',     key: 'supermarket' },
      { header: 'Branch',          key: 'branch' },
      { header: 'Qty Delivered',   key: 'qty_delivered',  style: { numFmt: '#,##0' } },
      { header: 'Qty Sold',        key: 'qty_sold',       style: { numFmt: '#,##0' } },
      { header: 'Qty Returned',    key: 'qty_returned',   style: { numFmt: '#,##0' } },
      { header: 'Balance (KG)',    key: 'qty_balance',    style: { numFmt: '#,##0' } },
      { header: 'Revenue (ETB)',   key: 'revenue',        style: { numFmt: '#,##0.00' } },
      { header: 'Price/KG',        key: 'price_per_kg',   style: { numFmt: '#,##0.00' } },
      { header: 'Delivery Date',   key: 'delivery_date' },
      { header: 'Status',          key: 'status' },
      { header: 'Driver',          key: 'driver' },
    ];

    ws.getRow(1).eachCell(applyHeaderStyle);
    ws.getRow(1).height = 22;

    rows.forEach((r, i) => {
      const row = ws.addRow(r);
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i % 2 === 0 ? 'FFFFFFFF' : 'FFFFF8F8' } };
    });

    // Summary row
    ws.addRow({});
    const totals = ws.addRow({
      fs_number:    'TOTALS',
      qty_delivered: { formula: `SUM(D2:D${rows.length + 1})` },
      qty_sold:      { formula: `SUM(E2:E${rows.length + 1})` },
      qty_returned:  { formula: `SUM(F2:F${rows.length + 1})` },
      qty_balance:   { formula: `SUM(G2:G${rows.length + 1})` },
      revenue:       { formula: `SUM(H2:H${rows.length + 1})` },
    });
    totals.font = { bold: true };
    totals.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8F8' } };

    autoWidth(ws);

    const filename = `tsion-deliveries-${Date.now()}.xlsx`;
    await persistAndSendWorkbook(res, wb, filename);
  } catch (err) { next(err); }
});

// ── Receivables / aging export ──────────────
router.get('/receivables', async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT s.code, s.name, s.branch, s.credit_limit, s.outstanding,
             ROUND(s.outstanding / NULLIF(s.credit_limit,0) * 100, 1) AS credit_pct,
             CASE
               WHEN s.outstanding > s.credit_limit THEN 'Over Limit'
               WHEN s.outstanding > s.credit_limit * 0.8 THEN 'Near Limit'
               ELSE 'Good'
             END AS credit_status,
             (SELECT MAX(p.payment_date) FROM payments p WHERE p.supermarket_id = s.id) AS last_payment,
             (SELECT MAX(d.delivery_date) FROM deliveries d WHERE d.supermarket_id = s.id) AS last_delivery
      FROM supermarkets s WHERE s.status = 'Active'
      ORDER BY s.outstanding DESC
    `);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Tsion ERP';
    const ws = wb.addWorksheet('Receivables');

    ws.columns = [
      { header: 'Code',            key: 'code' },
      { header: 'Supermarket',     key: 'name' },
      { header: 'Branch',          key: 'branch' },
      { header: 'Credit Limit',    key: 'credit_limit',  style: { numFmt: '#,##0.00' } },
      { header: 'Outstanding',     key: 'outstanding',   style: { numFmt: '#,##0.00' } },
      { header: 'Credit Used (%)', key: 'credit_pct',    style: { numFmt: '0.0"%"' } },
      { header: 'Credit Status',   key: 'credit_status' },
      { header: 'Last Payment',    key: 'last_payment' },
      { header: 'Last Delivery',   key: 'last_delivery' },
    ];

    ws.getRow(1).eachCell(applyHeaderStyle);
    ws.getRow(1).height = 22;

    rows.forEach((r, i) => {
      const row = ws.addRow(r);
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i % 2 === 0 ? 'FFFFFFFF' : 'FFFFF8F8' } };
      const statusCell = row.getCell('credit_status');
      const statusColors = { 'Over Limit': 'FFFFCDD2', 'Near Limit': 'FFFFF9C4', 'Good': 'FFE8F5E9' };
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusColors[r.credit_status] || 'FFFFFFFF' } };
    });

    autoWidth(ws);

    const filename = `tsion-receivables-${Date.now()}.xlsx`;
    await persistAndSendWorkbook(res, wb, filename);
  } catch (err) { next(err); }
});

// ── CSV export (simple, universal) ─────────
router.get('/csv/:table', async (req, res, next) => {
  try {
    const allowed = ['supermarkets', 'deliveries', 'payments', 'inventory_transactions'];
    const tbl = req.params.table;
    if (!allowed.includes(tbl)) return res.status(400).json({ error: 'Invalid table' });

    const { rows } = await db.query(`SELECT * FROM ${tbl} ORDER BY created_at DESC LIMIT 5000`);
    if (!rows.length) return res.json({ message: 'No data' });

    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => {
        const v = r[h] === null ? '' : String(r[h]);
        return v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v;
      }).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=tsion-${tbl}-${Date.now()}.csv`);
    res.send(csv);
  } catch (err) { next(err); }
});

module.exports = router;
