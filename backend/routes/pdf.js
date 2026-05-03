const router      = require('express').Router();
const db          = require('../db');
const PDFDocument = require('pdfkit');
const COMPANY     = require('../config/company');
const { saveBuffer } = require('../lib/fileStore');

const RED   = '#8B1A1A';
const RED2  = '#A52020';
const DARK  = '#1C1C1C';
const MID   = '#555555';
const LIGHT = '#888888';
const RULE  = '#DDDDDD';
const PINK  = '#FDF5F5';
const PINK2 = '#F5EDED';
const WHITE = '#FFFFFF';

// ── Helpers ─────────────────────────────────────────────────────

function birr(n) {
  const v = parseFloat(n) || 0;
  return 'ETB ' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtNum(n) {
  return parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function dateStr(d) {
  if (!d) return '\u2014';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

function shortDate(d) {
  if (!d) return '\u2014';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function streamToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

async function persistAndSend(res, name, buffer, contentType) {
  await saveBuffer(`generated_pdfs/${name}`, buffer, contentType);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"`);
  res.setHeader('Content-Length', String(buffer.length));
  res.send(buffer);
}

const W = 595.28; // A4 point width

// Branded header — returns next y position
function drawHeader(doc, docType) {
  doc.rect(0, 0, W, 76).fill(RED);
  doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(17)
     .text(COMPANY.name, 40, 16, { width: 340, lineBreak: false });
  doc.fillColor('#FFCCCC').font('Helvetica').fontSize(8.5)
     .text(COMPANY.tagline, 40, 38, { width: 340, lineBreak: false });
  doc.fillColor('#FFDDDD').fontSize(8)
     .text(COMPANY.phone + '   |   ' + COMPANY.address, 40, 53, { width: 340, lineBreak: false });
  doc.roundedRect(W - 158, 16, 118, 44, 5).fill(RED2);
  doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(10)
     .text(docType, W - 158, 28, { width: 118, align: 'center', lineBreak: false });
  doc.fillColor(DARK).font('Helvetica').fontSize(10);
  return 88;
}

// Footer
function drawFooter(doc) {
  const fy = doc.page.height - 50;
  doc.moveTo(40, fy).lineTo(W - 40, fy).strokeColor(RULE).lineWidth(0.5).stroke();
  doc.fillColor(LIGHT).font('Helvetica').fontSize(7.5)
     .text(COMPANY.name + '  |  ' + COMPANY.phone + '  |  ' + COMPANY.address,
           40, fy + 8, { width: W - 80, align: 'center', lineBreak: false });
  doc.text('This is a computer-generated document.',
           40, fy + 21, { width: W - 80, align: 'center', lineBreak: false });
}

// Section label — tinted bar with red title; returns next y
function sectionBar(doc, text, y) {
  doc.rect(40, y, W - 80, 19).fill(PINK2);
  doc.fillColor(RED).font('Helvetica-Bold').fontSize(8)
     .text(text.toUpperCase(), 48, y + 6, { width: W - 96, lineBreak: false });
  return y + 25;
}

// Ref bar beneath header
function refBar(doc, left, right, y) {
  doc.rect(40, y, W - 80, 26).fill(PINK);
  doc.fillColor(RED).font('Helvetica-Bold').fontSize(12)
     .text(left, 50, y + 7, { lineBreak: false });
  doc.fillColor(MID).font('Helvetica').fontSize(9)
     .text(right, 40, y + 8, { width: W - 80, align: 'right', lineBreak: false });
  return y + 36;
}

// Key:Value row (fixed x coords, no doc.y mutation)
function kvRow(doc, label, value, x, y, lw, vw) {
  doc.fillColor(LIGHT).font('Helvetica').fontSize(8.5)
     .text(label, x, y, { width: lw, lineBreak: false });
  doc.fillColor(DARK).font('Helvetica').fontSize(8.5)
     .text(value || '\u2014', x + lw + 4, y, { width: vw, lineBreak: false });
}

// Table header row — returns next y
function tHead(doc, cols, y) {
  doc.rect(40, y, W - 80, 20).fill(RED);
  doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(8.5);
  cols.forEach(c => {
    doc.text(c.h, c.x, y + 6, { width: c.w, align: c.a || 'left', lineBreak: false });
  });
  return y + 20;
}

// Table data row — returns next y
function tRow(doc, cols, vals, y, shade) {
  if (shade) doc.rect(40, y, W - 80, 20).fill(PINK);
  doc.fillColor(DARK).font('Helvetica').fontSize(8.5);
  cols.forEach((c, i) => {
    doc.text(vals[i] || '', c.x, y + 6, { width: c.w, align: c.a || 'left', lineBreak: false });
  });
  return y + 20;
}

// ─────────────────────────────────────────────────────────────────
// 1. DELIVERY NOTE
// ─────────────────────────────────────────────────────────────────
router.get('/delivery-note/:deliveryId', async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT d.*, s.name AS sm_name, s.branch, s.address AS sm_address,
             s.contact_name, s.phone AS sm_phone, s.tin AS sm_tin, s.code AS sm_code
      FROM deliveries d
      JOIN supermarkets s ON s.id = d.supermarket_id
      WHERE d.id = $1
    `, [req.params.deliveryId]);
    if (!rows.length) return res.status(404).json({ error: 'Delivery not found' });
    const d = rows[0];

    const { rows: [pr] } = await db.query(`SELECT price_per_kg FROM pricing ORDER BY effective_date DESC LIMIT 1`);
    const priceKg  = parseFloat(pr?.price_per_kg || 85);
    const totalVal = parseFloat(d.qty_delivered) * priceKg;

    const doc  = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const name = `delivery-note-${d.fs_number}.pdf`;
    const bufferPromise = streamToBuffer(doc);

    let y = drawHeader(doc, 'DELIVERY NOTE');
    y = refBar(doc, 'FS#: ' + d.fs_number, 'Delivery date: ' + dateStr(d.delivery_date), y);

    // FROM / TO two boxes
    const bw = Math.floor((W - 92) / 2);
    const bh = 98;
    doc.rect(40, y, bw, bh).lineWidth(0.5).stroke(RULE);
    doc.rect(40, y, bw, 17).fill(PINK2);
    doc.fillColor(RED).font('Helvetica-Bold').fontSize(8)
       .text('FROM \u2014 SUPPLIER', 48, y + 5, { lineBreak: false });
    let ly = y + 24;
    const lw1 = 60, vw1 = bw - 76;
    kvRow(doc, 'Company',  COMPANY.name,    48, ly, lw1, vw1); ly += 14;
    kvRow(doc, 'Phone',    COMPANY.phone,   48, ly, lw1, vw1); ly += 14;
    kvRow(doc, 'Address',  COMPANY.address, 48, ly, lw1, vw1); ly += 14;
    if (COMPANY.tin) kvRow(doc, 'TIN', COMPANY.tin, 48, ly, lw1, vw1);

    const rx = 52 + bw;
    doc.rect(rx, y, bw, bh).lineWidth(0.5).stroke(RULE);
    doc.rect(rx, y, bw, 17).fill(PINK2);
    doc.fillColor(RED).font('Helvetica-Bold').fontSize(8)
       .text('TO \u2014 RECIPIENT', rx + 8, y + 5, { lineBreak: false });
    let ry2 = y + 24;
    const lw2 = 68, vw2 = bw - 84;
    kvRow(doc, 'Supermarket', d.sm_name,        rx + 8, ry2, lw2, vw2); ry2 += 14;
    kvRow(doc, 'Branch',      d.branch,          rx + 8, ry2, lw2, vw2); ry2 += 14;
    kvRow(doc, 'Contact',     d.contact_name,    rx + 8, ry2, lw2, vw2); ry2 += 14;
    kvRow(doc, 'Phone',       d.sm_phone,        rx + 8, ry2, lw2, vw2); ry2 += 14;
    kvRow(doc, 'TIN',         d.sm_tin || '\u2014', rx + 8, ry2, lw2, vw2); ry2 += 14;
    kvRow(doc, 'Address',     d.sm_address,      rx + 8, ry2, lw2, vw2);

    y += bh + 14;
    y = sectionBar(doc, 'Goods Delivered', y);

    const tCols = [
      { h: '#',           x: 48,  w: 20,  a: 'center' },
      { h: 'Description', x: 76,  w: 244, a: 'left'   },
      { h: 'Qty (KG)',    x: 326, w: 64,  a: 'right'  },
      { h: 'Unit Price',  x: 396, w: 74,  a: 'right'  },
      { h: 'Total',       x: 476, w: 70,  a: 'right'  },
    ];
    y = tHead(doc, tCols, y);
    y = tRow(doc, tCols,
      ['1', 'Tsion Parboiled Brown Rice (1 KG bags)', fmtNum(d.qty_delivered), birr(priceKg), birr(totalVal)],
      y, true);

    // Total row
    doc.rect(40, y, W - 80, 24).fill(PINK2);
    doc.moveTo(40, y).lineTo(W - 40, y).strokeColor(RED).lineWidth(0.5).stroke();
    doc.fillColor(RED).font('Helvetica-Bold').fontSize(10)
       .text('TOTAL VALUE', 48, y + 7, { lineBreak: false });
    doc.fillColor(RED).font('Helvetica-Bold').fontSize(11)
       .text(birr(totalVal), 476, y + 6, { width: 70, align: 'right', lineBreak: false });
    y += 30;

    doc.fillColor(LIGHT).font('Helvetica').fontSize(8)
       .text('Payment terms: Consignment \u2014 payment upon submission of sale report.', 40, y, { lineBreak: false });
    y += 16;

    if (d.notes) {
      doc.fillColor(DARK).font('Helvetica').fontSize(9).text('Notes: ' + d.notes, 40, y); y += 16;
    }
    y += 18;

    // Signatures — clamped so they never fall off-page
    y = Math.min(y, doc.page.height - 115);
    const sw = 160;
    const sPositions = [40, W - 40 - sw];
    const sLabels = ['Delivered by (Name & Signature)', 'Received by (Name & Signature)'];
    sPositions.forEach((sx, i) => {
      doc.moveTo(sx, y + 34).lineTo(sx + sw, y + 34).strokeColor(DARK).lineWidth(0.5).stroke();
      doc.fillColor(LIGHT).font('Helvetica').fontSize(7.5)
         .text(sLabels[i], sx, y + 38, { width: sw, lineBreak: false });
      doc.text('Date: _____________________', sx, y + 51, { width: sw, lineBreak: false });
    });

    drawFooter(doc);
    doc.end();
    const buffer = await bufferPromise;
    await persistAndSend(res, name, buffer, 'application/pdf');
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────
// 2. SALES RECEIPT
// ─────────────────────────────────────────────────────────────────
async function getSalesReceiptContext(deliveryId, reqQuery = {}) {
  const { rows } = await db.query(`
    SELECT d.*, s.name AS sm_name, s.branch, s.address AS sm_address,
           s.contact_name, s.phone AS sm_phone, s.tin AS sm_tin, s.outstanding
    FROM deliveries d
    JOIN supermarkets s ON s.id = d.supermarket_id
    WHERE d.id = $1
  `, [deliveryId]);
  if (!rows.length) return null;

  const d = rows[0];
  const { rows: [pr] } = await db.query(`SELECT price_per_kg FROM pricing ORDER BY effective_date DESC LIMIT 1`);
  const priceKg = parseFloat(pr?.price_per_kg || 85);
  const deliveredQty = parseFloat(d.qty_delivered || 0);
  const rawAdjust = parseFloat(reqQuery.adjust_kg || 0);
  const manualAdjustKg = Number.isFinite(rawAdjust) ? rawAdjust : 0;
  const soldQty = Math.max(0, deliveredQty + manualAdjustKg);
  const bwPrint = String(reqQuery.bw || '').toLowerCase() === '1' || String(reqQuery.bw || '').toLowerCase() === 'true';

  let productLines = [];
  if (reqQuery.product_lines) {
    try {
      const parsed = JSON.parse(String(reqQuery.product_lines));
      if (Array.isArray(parsed)) {
        productLines = parsed
          .map(line => ({
            name: String(line?.name || '').trim(),
            qty: parseFloat(line?.qty || 0)
          }))
          .filter(line => line.name && Number.isFinite(line.qty) && line.qty > 0);
      }
    } catch {
      productLines = [];
    }
  }

  if (!productLines.length) {
    productLines = [{ name: 'Tsion Parboiled Brown Rice', qty: soldQty }].filter(line => line.qty > 0);
  }

  const computedSoldQty = productLines.reduce((sum, line) => sum + line.qty, 0);
  const effectiveSoldQty = computedSoldQty > 0 ? computedSoldQty : soldQty;
  const remainingQty = Math.max(0, deliveredQty - effectiveSoldQty);
  const fsOverride = (reqQuery.fs_no || '').toString().trim();
  const docDateRaw = (reqQuery.doc_date || '').toString().trim();
  const parsedDocDate = docDateRaw ? Date.parse(docDateRaw) : NaN;
  const receiptDateLabel = Number.isNaN(parsedDocDate) ? dateStr(d.delivery_date) : dateStr(new Date(parsedDocDate));

  return {
    d,
    priceKg,
    deliveredQty,
    manualAdjustKg,
    soldQty: effectiveSoldQty,
    remainingQty,
    soldVal: effectiveSoldQty * priceKg,
    outstanding: parseFloat(d.outstanding || 0),
    adjustNote: (reqQuery.adjust_note || '').toString().trim(),
    receiptFsNumber: fsOverride || d.fs_number,
    receiptDateLabel,
    productLines,
    bwPrint
  };
}

function drawSalesReceiptPage(doc, ctx, isAttachmentPage) {
  const { d, priceKg, deliveredQty, manualAdjustKg, soldQty, remainingQty, soldVal, outstanding, adjustNote, receiptFsNumber, receiptDateLabel, productLines, bwPrint } = ctx;
  const PRIMARY = bwPrint ? '#111111' : RED;
  const TINT = bwPrint ? '#F1F1F1' : PINK2;
  const STRIPE = bwPrint ? '#F7F7F7' : PINK;
  const VALUE_BG = bwPrint ? '#141414' : RED;

  let y;
  if (bwPrint) {
    doc.rect(0, 0, W, 70).fill(PRIMARY);
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(16)
       .text(COMPANY.name, 40, 15, { width: 360, lineBreak: false });
    doc.fillColor('#E9E9E9').font('Helvetica').fontSize(8)
       .text(COMPANY.phone + '   |   ' + COMPANY.address, 40, 39, { width: 360, lineBreak: false });
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(10)
       .text(isAttachmentPage ? 'SALES RECEIPT ATTACHMENT' : 'SALES RECEIPT', W - 220, 20, { width: 180, align: 'right' });
    y = 82;
    doc.rect(40, y, W - 80, 24).fill('#EFEFEF');
    doc.fillColor('#222').font('Helvetica-Bold').fontSize(9.5)
       .text('Receipt for: ' + receiptFsNumber, 50, y + 7, { lineBreak: false });
    doc.fillColor('#444').font('Helvetica').fontSize(8.5)
       .text('Generated: ' + shortDate(new Date()), 40, y + 7, { width: W - 90, align: 'right' });
    y += 32;
  } else {
    y = drawHeader(doc, isAttachmentPage ? 'SALES RECEIPT ATTACHMENT' : 'SALES RECEIPT');
    y = refBar(doc, 'Receipt for: ' + receiptFsNumber, 'Generated: ' + shortDate(new Date()), y);
  }

  function drawSectionTitle(label, atY) {
    doc.rect(40, atY, W - 80, 18).fill(TINT);
    doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(8.5)
       .text(label.toUpperCase(), 48, atY + 5, { width: W - 96, lineBreak: false });
    return atY + 24;
  }

  function drawTableHead(cols, atY) {
    doc.rect(40, atY, W - 80, 19).fill(PRIMARY);
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(8.5);
    cols.forEach(c => {
      doc.text(c.h, c.x, atY + 5, { width: c.w, align: c.a || 'left', lineBreak: false });
    });
    return atY + 19;
  }

  function drawTableRow(cols, vals, atY, shade) {
    if (shade) doc.rect(40, atY, W - 80, 18).fill(STRIPE);
    doc.fillColor(DARK).font('Helvetica').fontSize(8.5);
    cols.forEach((c, idx) => {
      doc.text(vals[idx] || '', c.x, atY + 5, { width: c.w, align: c.a || 'left', lineBreak: false });
    });
    return atY + 18;
  }

  if (isAttachmentPage) {
    // Light diagonal watermark for attachment copy background.
    doc.save();
    doc.rotate(-32, { origin: [W / 2, doc.page.height / 2] });
    doc.fillColor(bwPrint ? '#E0E0E0' : '#F3DFDF').font('Helvetica-Bold').fontSize(76)
       .text('ATTACHMENT', W / 2 - 215, doc.page.height / 2 - 18, { lineBreak: false });
    doc.restore();
  }

  // SM info
  y = drawSectionTitle('Supermarket Details', y);
  const smInfo = [
    ['Name', d.sm_name], ['Branch', d.branch], ['Contact', d.contact_name],
    ['Phone', d.sm_phone], ['TIN', d.sm_tin], ['Address', d.sm_address],
  ];
  smInfo.forEach(([lbl, val], i) => {
    if (i % 2 === 0) doc.rect(40, y, W - 80, 16).fill(STRIPE);
    kvRow(doc, lbl, val, 50, y + 4, 80, W - 180);
    y += 16;
  });
  y += 8;

  // Consignment summary
  y = drawSectionTitle('Consignment Summary', y);
  [
    ['Delivery Reference', receiptFsNumber],
    ['Receipt Date', receiptDateLabel],
    ['Qty Delivered', fmtNum(deliveredQty) + ' KG'],
  ].forEach(([lbl, val], i) => {
    if (i % 2 === 0) doc.rect(40, y, W - 80, 16).fill(STRIPE);
    kvRow(doc, lbl, val, 50, y + 4, 120, W - 220);
    y += 16;
  });
  y += 8;

  // Product breakdown for multi-product sales
  y = drawSectionTitle('Product Breakdown', y);
  const pCols = [
    { h: '#', x: 48, w: 20, a: 'center' },
    { h: 'Product', x: 74, w: 232, a: 'left' },
    { h: 'Qty (KG)', x: 312, w: 70, a: 'right' },
    { h: 'Unit Price', x: 388, w: 74, a: 'right' },
    { h: 'Line Total', x: 468, w: 78, a: 'right' }
  ];
  y = drawTableHead(pCols, y);
  productLines.forEach((line, idx) => {
    y = drawTableRow(
      pCols,
      [String(idx + 1), line.name, fmtNum(line.qty), birr(priceKg), birr(line.qty * priceKg)],
      y,
      idx % 2 === 0
    );
  });
  y += 6;

  // Financial table (default assumes all delivered quantity sold)
  y = drawSectionTitle('Sales & Financial Summary', y);
  const fCols = [
    { h: 'Description', x: 48,  w: 300, a: 'left'  },
    { h: 'Value',       x: 390, w: 156, a: 'right' },
  ];
  y = drawTableHead(fCols, y);
  [
    ['Delivered Quantity', fmtNum(deliveredQty) + ' KG'],
    ['Default Sold Assumption', fmtNum(deliveredQty) + ' KG'],
    ['Manual Adjustment (+/-)', fmtNum(manualAdjustKg) + ' KG'],
    ['Final Sold Quantity', fmtNum(soldQty) + ' KG'],
    ['Remaining Quantity', fmtNum(remainingQty) + ' KG'],
    ['Selling Price per KG', birr(priceKg)],
    ['Gross Sales Value', birr(soldVal)],
  ].forEach(([lbl, val], i) => {
    y = drawTableRow(fCols, [lbl, val], y, i % 2 === 0);
  });

  if (adjustNote) {
    y += 6;
    doc.fillColor(MID).font('Helvetica').fontSize(8.5)
       .text('Adjustment note: ' + adjustNote, 40, y, { width: W - 80 });
    y = doc.y + 8;
  }

    // Total bar
  y += 6;
    doc.rect(40, y, W - 80, 30).fill(VALUE_BG);
  doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(10)
      .text('TOTAL (GROSS SALES VALUE)', 50, y + 9, { lineBreak: false });
  doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(12)
      .text(birr(soldVal), 390, y + 8, { width: 156, align: 'right', lineBreak: false });
  y += 40;

  const footerLine = isAttachmentPage
    ? 'Attachment copy accompanies the sales receipt for filing and reference.'
     : `Sales default assumes full delivery sold. Use manual adjustment when needed. Current outstanding: ${birr(outstanding)}.`;
  doc.fillColor(LIGHT).font('Helvetica').fontSize(7.5)
     .text(footerLine, 40, y, { width: W - 80 });

  drawFooter(doc);
}

router.get('/sales-receipt/:deliveryId', async (req, res, next) => {
  try {
    const ctx = await getSalesReceiptContext(req.params.deliveryId, req.query);
    if (!ctx) return res.status(404).json({ error: 'Delivery not found' });

    const doc    = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const name   = `sales-receipt-${ctx.d.fs_number}.pdf`;
    const bufferPromise = streamToBuffer(doc);

    drawSalesReceiptPage(doc, ctx, false);

    doc.end();
    const buffer = await bufferPromise;
    await persistAndSend(res, name, buffer, 'application/pdf');
  } catch (err) { next(err); }
});

router.get('/sales-receipt-attachment/:deliveryId', async (req, res, next) => {
  try {
    const ctx = await getSalesReceiptContext(req.params.deliveryId, req.query);
    if (!ctx) return res.status(404).json({ error: 'Delivery not found' });

    const doc    = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const name   = `sales-receipt-attachment-${ctx.d.fs_number}.pdf`;
    const bufferPromise = streamToBuffer(doc);

    drawSalesReceiptPage(doc, ctx, true);

    doc.end();
    const buffer = await bufferPromise;
    await persistAndSend(res, name, buffer, 'application/pdf');
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────
// 3. PRICE CHANGE LETTER
// ─────────────────────────────────────────────────────────────────
router.post('/price-change-letter', async (req, res, next) => {
  try {
    const { new_price, effective_date, message_body, supermarket_ids } = req.body;
    if (!new_price || !effective_date)
      return res.status(400).json({ error: 'new_price and effective_date are required' });

    let smQ = `SELECT * FROM supermarkets WHERE status='Active' ORDER BY name`;
    let smP = [];
    if (supermarket_ids && supermarket_ids.length) {
      smQ = `SELECT * FROM supermarkets WHERE id=ANY($1) ORDER BY name`;
      smP = [supermarket_ids];
    }
    const { rows: sms } = await db.query(smQ, smP);
    const { rows: [opr] } = await db.query(`SELECT price_per_kg FROM pricing ORDER BY effective_date DESC LIMIT 1`);
    const oldPrice = parseFloat(opr?.price_per_kg || 0);
    const newPrice = parseFloat(new_price);

    const doc    = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const ref    = 'PCL-' + Date.now();
    const name   = `price-change-letter-${ref}.pdf`;
    const bufferPromise = streamToBuffer(doc);

    sms.forEach((sm, idx) => {
      if (idx > 0) doc.addPage();

      // Letterhead
      doc.rect(0, 0, W, 76).fill(RED);
      doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(17)
         .text(COMPANY.name, 60, 14, { width: 360, lineBreak: false });
      doc.fillColor('#FFCCCC').font('Helvetica').fontSize(8.5)
         .text(COMPANY.tagline, 60, 37, { lineBreak: false });
      doc.fillColor('#FFDDDD').fontSize(8)
         .text(COMPANY.phone + '   |   ' + COMPANY.address, 60, 52, { lineBreak: false });
      doc.fillColor(WHITE).font('Helvetica').fontSize(8)
         .text('Ref: ' + ref, W - 190, 18, { width: 150, align: 'right', lineBreak: false })
         .text('Date: ' + dateStr(new Date()), W - 190, 32, { width: 150, align: 'right', lineBreak: false });

      let y = 96;

      // Recipient
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10.5).text(sm.name, 60, y); y += 16;
      doc.font('Helvetica').fontSize(9.5);
      if (sm.branch)       { doc.fillColor(DARK).text(sm.branch,       60, y); y += 13; }
      if (sm.address)      { doc.fillColor(DARK).text(sm.address,      60, y); y += 13; }
      if (sm.contact_name) { doc.fillColor(MID ).text('Attn: ' + sm.contact_name, 60, y); y += 13; }
      y += 10;

      // Subject
      doc.moveTo(60, y).lineTo(W - 60, y).strokeColor(RED).lineWidth(1).stroke(); y += 8;
      doc.fillColor(RED).font('Helvetica-Bold').fontSize(12)
         .text('SUBJECT: PRICE ADJUSTMENT NOTICE', 60, y, { width: W - 120 }); y += 18;
      doc.fillColor(MID).font('Helvetica').fontSize(9)
         .text('Effective from: ' + dateStr(effective_date), 60, y, { lineBreak: false }); y += 8;
      doc.moveTo(60, y).lineTo(W - 60, y).strokeColor(RED).lineWidth(0.5).stroke(); y += 14;

      // Salutation + body
      doc.fillColor(DARK).font('Helvetica').fontSize(10)
         .text('Dear ' + (sm.contact_name || 'Valued Partner') + ',', 60, y); y += 18;

      const body = message_body ||
        `We would like to inform you that ${COMPANY.name} will be revising the selling price of our Parboiled Brown Rice, effective ${dateStr(effective_date)}.\n\nThis adjustment reflects recent changes in production and logistics costs. We remain committed to delivering the highest quality product and to maintaining our valued partnership with your business.\n\nWe appreciate your continued trust and support. Please do not hesitate to contact us if you have any questions.`;

      doc.font('Helvetica').fontSize(10).fillColor(DARK)
         .text(body, 60, y, { width: W - 120, align: 'justify', lineBreak: true });
      y = doc.y + 18;

      // Price box
      const bh = 82;
      doc.rect(60, y, W - 120, bh).lineWidth(0.5).stroke(RULE);
      doc.rect(60, y, W - 120, 19).fill(PINK2);
      doc.fillColor(RED).font('Helvetica-Bold').fontSize(8.5)
         .text('PRICE SUMMARY', 60, y + 6, { width: W - 120, align: 'center', lineBreak: false });

      let py = y + 27;
      doc.fillColor(LIGHT).font('Helvetica').fontSize(9)
         .text('Current price per KG:', 80, py, { lineBreak: false });
      doc.fillColor(DARK).font('Helvetica').fontSize(9)
         .text(birr(oldPrice), W - 140, py, { width: 80, align: 'right', lineBreak: false }); py += 16;

      doc.fillColor(LIGHT).font('Helvetica').fontSize(9)
         .text('New price per KG:', 80, py, { lineBreak: false });
      doc.fillColor(RED).font('Helvetica-Bold').fontSize(12)
         .text(birr(newPrice), W - 140, py - 1, { width: 80, align: 'right', lineBreak: false }); py += 18;

      doc.fillColor(LIGHT).font('Helvetica').fontSize(8)
         .text('Effective from: ' + dateStr(effective_date), 80, py, { lineBreak: false });

      y += bh + 20;

      // Closing
      doc.fillColor(DARK).font('Helvetica').fontSize(10)
         .text('Thank you for your understanding and continued partnership.', 60, y, { width: W - 120 });
      y = doc.y + 14;
      doc.text('Sincerely,', 60, y); y += 38;
      doc.moveTo(60, y).lineTo(220, y).strokeColor(DARK).lineWidth(0.5).stroke(); y += 5;
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10).text(COMPANY.name, 60, y); y += 14;
      doc.fillColor(LIGHT).font('Helvetica').fontSize(8.5).text('Authorized Signatory', 60, y);

      drawFooter(doc);
    });

    doc.end();

    await db.query(
      `INSERT INTO price_letters (ref, new_price, effective_date, message_body, sent_to)
       VALUES ($1,$2,$3,$4,$5)`,
      [ref, newPrice, effective_date, message_body || '', sms.map(s => s.name)]
    );

    const buffer = await bufferPromise;
    await persistAndSend(res, name, buffer, 'application/pdf');
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────
// 4. DELIVERY ORDER
// ─────────────────────────────────────────────────────────────────
router.post('/delivery-order', async (req, res, next) => {
  try {
    const { supermarket_id, qty, delivery_date, driver, notes } = req.body;
    if (!supermarket_id || !qty)
      return res.status(400).json({ error: 'supermarket_id and qty required' });

    const { rows: [sm] } = await db.query(`SELECT * FROM supermarkets WHERE id=$1`, [supermarket_id]);
    if (!sm) return res.status(404).json({ error: 'Supermarket not found' });

    const { rows: [pr] } = await db.query(`SELECT price_per_kg FROM pricing ORDER BY effective_date DESC LIMIT 1`);
    const priceKg  = parseFloat(pr?.price_per_kg || 85);
    const totalVal = parseFloat(qty) * priceKg;
    const ref      = 'DO-' + Date.now();

    const doc    = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const name   = `delivery-order-${ref}.pdf`;
    const bufferPromise = streamToBuffer(doc);

    const pageH = doc.page.height;
    const cutY = Math.floor(pageH / 2);
    const left = 24;
    const width = W - 48;

    function drawHalfReceipt(topY, copyLabel) {
      const halfH = cutY - 32;
      const right = left + width;
      let y = topY + 10;

      doc.rect(left, topY, width, halfH).lineWidth(0.8).stroke(RULE);
      doc.rect(left, y, width, 26).fill(RED);
      doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(11.5)
        .text('OFFICIAL DELIVERY RECEIPT', left + 10, y + 7, { width: width - 160, lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(8.5)
         .text(copyLabel.toUpperCase(), right - 146, y + 8, { width: 136, align: 'right', lineBreak: false });
      y += 34;

      doc.fillColor(DARK).font('Helvetica').fontSize(8.8)
         .text(`Ref: ${ref}   |   Issued: ${shortDate(new Date())}   |   Delivery Date: ${dateStr(delivery_date || new Date())}`,
               left + 10, y, { width: width - 20 });
      y += 18;

      const rows = [
        ['Supplier', COMPANY.name],
        ['Recipient', sm.name + (sm.branch ? ' — ' + sm.branch : '')],
        ['Address', sm.address || '—'],
        ['Recipient Contact', (sm.contact_name || '—') + (sm.phone ? ' · ' + sm.phone : '')],
        ['Assigned Driver', driver || 'TBD'],
        ['Product', 'Tsion Parboiled Brown Rice (1 KG bags)'],
        ['Quantity', fmtNum(qty) + ' KG'],
        ['Price / KG', birr(priceKg)],
        ['Estimated Value', birr(totalVal)]
      ];

      rows.forEach(([label, value], idx) => {
        if (idx % 2 === 0) doc.rect(left + 6, y, width - 12, 14).fill(PINK);
        kvRow(doc, label, value, left + 12, y + 3, 88, width - 118);
        y += 14;
      });

      if (notes) {
        doc.fillColor(MID).font('Helvetica').fontSize(8)
           .text('Note: ' + notes, left + 12, y + 4, { width: width - 24, lineBreak: false });
      }

      const signY = topY + halfH - 46;
      const sigW = Math.floor((width - 40) / 2);
      const sigLeftX = left + 12;
      const sigRightX = sigLeftX + sigW + 16;
      doc.moveTo(sigLeftX, signY).lineTo(sigLeftX + sigW, signY).strokeColor(DARK).lineWidth(0.5).stroke();
      doc.moveTo(sigRightX, signY).lineTo(sigRightX + sigW, signY).strokeColor(DARK).lineWidth(0.5).stroke();
      doc.fillColor(LIGHT).font('Helvetica').fontSize(7.5)
         .text('Issued / Released By (Name & Signature)', sigLeftX, signY + 4, { width: sigW });
      doc.text('Received By (Name & Signature)', sigRightX, signY + 4, { width: sigW });
      doc.text('Date: ____________', sigLeftX, signY + 16, { width: sigW, lineBreak: false });
      doc.text('Date: ____________', sigRightX, signY + 16, { width: sigW, lineBreak: false });
    }

    drawHalfReceipt(16, 'Warehouse Copy');
    doc.moveTo(left, cutY).lineTo(W - left, cutY).strokeColor(RULE).lineWidth(0.7).stroke();
    drawHalfReceipt(cutY + 14, 'Outlet Copy');
    doc.end();
    const buffer = await bufferPromise;
    await persistAndSend(res, name, buffer, 'application/pdf');
  } catch (err) { next(err); }
});

module.exports = router;
