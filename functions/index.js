const express = require('express');
const cors = require('cors');
const multer = require('multer');
const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { v4: uuidv4 } = require('uuid');

admin.initializeApp();

const firestore = admin.firestore();

function getBucket() {
  const configuredBucket = process.env.FIREBASE_STORAGE_BUCKET
    || admin.app().options.storageBucket
    || (process.env.GCLOUD_PROJECT ? `${process.env.GCLOUD_PROJECT}.appspot.com` : null);
  if (!configuredBucket) {
    throw new Error('Firebase Storage bucket is not configured. Set FIREBASE_STORAGE_BUCKET or deploy inside a Firebase project.');
  }
  return admin.storage().bucket(configuredBucket);
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '10mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const COMPANY = {
  name: process.env.COMPANY_NAME || 'Tsion Parboiled Brown Rice',
  phone: process.env.COMPANY_PHONE || '+251 94 413 5444',
  address: process.env.COMPANY_ADDRESS || 'Addis Ababa, Ethiopia',
  tin: process.env.COMPANY_TIN || '',
  tagline: process.env.COMPANY_TAGLINE || '100% Natural · Healthy · Gluten Free · Made in Ethiopia'
};

const DEFAULT_PRICE = 85;
const W = 595.28;
const RED = '#8B1A1A';
const RED2 = '#A52020';
const DARK = '#1C1C1C';
const MID = '#555555';
const LIGHT = '#888888';
const RULE = '#DDDDDD';
const PINK = '#FDF5F5';
const PINK2 = '#F5EDED';
const WHITE = '#FFFFFF';
const BRAND = 'FF8B1A1A';

function nowIso() {
  return new Date().toISOString();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function birr(value) {
  const amount = toNumber(value);
  return 'ETB ' + amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtNum(value) {
  return toNumber(value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function dateStr(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

function shortDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function storageKey(prefix, fileName) {
  return `${prefix}/${fileName}`;
}

function sanitizeBaseName(fileName) {
  const parts = String(fileName || '').split('.');
  if (parts.length === 1) {
    return parts[0].replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'attachment';
  }
  const ext = parts.pop();
  void ext;
  return parts.join('.').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'attachment';
}

function jsonDoc(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

function sortByNewest(items, primaryKey, fallbackKey = 'created_at') {
  return (items || []).slice().sort((left, right) => {
    const rightPrimary = Date.parse(right[primaryKey] || 0) || 0;
    const leftPrimary = Date.parse(left[primaryKey] || 0) || 0;
    if (rightPrimary !== leftPrimary) return rightPrimary - leftPrimary;
    const rightFallback = Date.parse(right[fallbackKey] || 0) || 0;
    const leftFallback = Date.parse(left[fallbackKey] || 0) || 0;
    return rightFallback - leftFallback;
  });
}

async function getAll(collectionName) {
  const snapshot = await firestore.collection(collectionName).get();
  return snapshot.docs.map(jsonDoc);
}

async function getDoc(collectionName, id) {
  const snapshot = await firestore.collection(collectionName).doc(id).get();
  if (!snapshot.exists) return null;
  return jsonDoc(snapshot);
}

async function getSetting(id, fallback = null) {
  const snapshot = await firestore.collection('settings').doc(id).get();
  return snapshot.exists ? snapshot.data() : fallback;
}

async function setSetting(id, value) {
  await firestore.collection('settings').doc(id).set(value, { merge: true });
}

async function getWarehouseStock() {
  const stock = await getSetting('warehouse_stock', null);
  if (stock) return stock;
  const initial = { current_qty: 0, total_received: 0, updated_at: nowIso() };
  await setSetting('warehouse_stock', initial);
  return initial;
}

async function getCurrentPrice() {
  const current = await getSetting('current_price', null);
  return current || { price_per_kg: DEFAULT_PRICE, effective_date: today(), notes: '', created_at: nowIso() };
}

async function getCompany() {
  return await getSetting('company', COMPANY) || COMPANY;
}

async function nextCounter(transaction, field) {
  const ref = firestore.collection('settings').doc('counters');
  const snapshot = await transaction.get(ref);
  const data = snapshot.exists ? snapshot.data() : {};
  const nextValue = toNumber(data[field]) + 1;
  transaction.set(ref, { [field]: nextValue, updated_at: nowIso() }, { merge: true });
  return nextValue;
}

function fileToResponse(fileName, metadata) {
  const displayName = fileName.includes('__')
    ? fileName.split('__').slice(2).join('__')
    : fileName.replace(/^[0-9]+-[0-9a-fA-F-]+-/, '');

  return {
    id: fileName,
    filename: fileName,
    originalName: displayName,
    size: Number(metadata.size || 0),
    uploadedAt: metadata.updated || metadata.timeCreated || nowIso(),
    url: `/api/uploads/attachments/${encodeURIComponent(fileName)}`
  };
}

async function saveStorageBuffer(key, buffer, contentType) {
  await getBucket().file(key).save(buffer, {
    resumable: false,
    contentType,
    metadata: {
      cacheControl: 'public, max-age=3600'
    }
  });
}

async function listStorageFiles(prefix) {
  const [files] = await getBucket().getFiles({ prefix: `${prefix}/` });
  const mapped = await Promise.all(files
    .filter(file => !file.name.endsWith('/'))
    .map(async file => {
      const [metadata] = await file.getMetadata();
      return {
        fileName: file.name.split('/').pop(),
        metadata
      };
    }));

  return mapped.sort((left, right) => {
    const r = Date.parse(right.metadata.updated || right.metadata.timeCreated || 0) || 0;
    const l = Date.parse(left.metadata.updated || left.metadata.timeCreated || 0) || 0;
    return r - l;
  });
}

async function streamStorageFile(res, key, fallbackType, downloadName, inline = true) {
  const file = getBucket().file(key);
  const [exists] = await file.exists();
  if (!exists) return false;
  const [metadata] = await file.getMetadata();
  res.setHeader('Content-Type', metadata.contentType || fallbackType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${String(downloadName || key.split('/').pop()).replace(/"/g, '')}"`);
  if (metadata.size) res.setHeader('Content-Length', String(metadata.size));
  file.createReadStream().pipe(res);
  return true;
}

async function persistGeneratedFile(name, buffer, contentType) {
  await saveStorageBuffer(storageKey('generated_pdfs', name), buffer, contentType);
}

async function listSupermarketsWithComputed(filters = {}) {
  const [supermarkets, deliveries] = await Promise.all([
    getAll('supermarkets'),
    getAll('deliveries')
  ]);

  const filtered = supermarkets.filter(sm => {
    if (filters.status && sm.status !== filters.status) return false;
    if (filters.search) {
      const q = String(filters.search).toLowerCase();
      const hay = [sm.name, sm.branch, sm.address].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return filtered
    .map(sm => ({
      ...sm,
      consignment_stock: deliveries
        .filter(delivery => delivery.supermarket_id === sm.id)
        .reduce((sum, delivery) => sum + toNumber(delivery.qty_delivered) - toNumber(delivery.qty_sold) - toNumber(delivery.qty_returned), 0)
    }))
    .sort((left, right) => {
      const r = Date.parse(right.created_at || 0) || 0;
      const l = Date.parse(left.created_at || 0) || 0;
      if (r !== l) return r - l;
      return String(left.name || '').localeCompare(String(right.name || ''));
    });
}

async function listDeliveriesJoined(filters = {}) {
  const [deliveries, supermarkets] = await Promise.all([
    getAll('deliveries'),
    getAll('supermarkets')
  ]);
  const map = new Map(supermarkets.map(item => [item.id, item]));

  return sortByNewest(
    deliveries
      .filter(delivery => {
        if (filters.supermarket_id && delivery.supermarket_id !== filters.supermarket_id) return false;
        if (filters.status && delivery.status !== filters.status) return false;
        return true;
      })
      .map(delivery => {
        const sm = map.get(delivery.supermarket_id) || {};
        return {
          ...delivery,
          supermarket_name: sm.name || null,
          supermarket_branch: sm.branch || null,
          supermarket_code: sm.code || null,
          supermarket_address: sm.address || null,
          supermarket_phone: sm.phone || null,
          supermarket_tin: sm.tin || null,
          contact_name: sm.contact_name || null,
          qty_balance: toNumber(delivery.qty_delivered) - toNumber(delivery.qty_sold) - toNumber(delivery.qty_returned)
        };
      }),
    'delivery_date'
  );
}

async function getDeliveryJoined(deliveryId) {
  const delivery = await getDoc('deliveries', deliveryId);
  if (!delivery) return null;
  const supermarket = await getDoc('supermarkets', delivery.supermarket_id);
  return {
    ...delivery,
    supermarket_name: supermarket?.name || null,
    supermarket_branch: supermarket?.branch || null,
    supermarket_code: supermarket?.code || null,
    supermarket_address: supermarket?.address || null,
    supermarket_phone: supermarket?.phone || null,
    supermarket_tin: supermarket?.tin || null,
    contact_name: supermarket?.contact_name || null,
    qty_balance: toNumber(delivery.qty_delivered) - toNumber(delivery.qty_sold) - toNumber(delivery.qty_returned),
    outstanding: toNumber(supermarket?.outstanding)
  };
}

async function listPaymentsJoined(filters = {}) {
  const [payments, supermarkets] = await Promise.all([
    getAll('payments'),
    getAll('supermarkets')
  ]);
  const map = new Map(supermarkets.map(item => [item.id, item]));
  return sortByNewest(
    payments
      .filter(payment => !filters.supermarket_id || payment.supermarket_id === filters.supermarket_id)
      .map(payment => ({
        ...payment,
        supermarket_name: map.get(payment.supermarket_id)?.name || null,
        supermarket_code: map.get(payment.supermarket_id)?.code || null
      })),
    'payment_date'
  );
}

async function getInventorySummaryData() {
  const [stock, deliveries] = await Promise.all([
    getWarehouseStock(),
    getAll('deliveries')
  ]);
  return {
    ...stock,
    total_distributed: deliveries.reduce((sum, delivery) => sum + toNumber(delivery.qty_delivered), 0),
    at_supermarkets: deliveries.reduce((sum, delivery) => sum + (toNumber(delivery.qty_delivered) - toNumber(delivery.qty_sold) - toNumber(delivery.qty_returned)), 0),
    total_returned: deliveries.reduce((sum, delivery) => sum + toNumber(delivery.qty_returned), 0)
  };
}

async function getDashboardData() {
  const [warehouse, supermarkets, salesReports, deliveries, payments] = await Promise.all([
    getWarehouseStock(),
    getAll('supermarkets'),
    getAll('sales_reports'),
    getAll('deliveries'),
    getAll('payments')
  ]);
  void payments;
  const activeSupermarkets = supermarkets.filter(sm => sm.status === 'Active');
  const totalReceivables = activeSupermarkets.reduce((sum, sm) => sum + toNumber(sm.outstanding), 0);
  const sales = {
    total_kg: salesReports.reduce((sum, report) => sum + toNumber(report.qty_sold), 0),
    total_revenue: salesReports.reduce((sum, report) => sum + toNumber(report.total_value), 0)
  };

  const topMap = new Map();
  for (const report of salesReports) {
    const current = topMap.get(report.supermarket_id) || { id: report.supermarket_id, total_sold: 0, revenue: 0 };
    current.total_sold += toNumber(report.qty_sold);
    current.revenue += toNumber(report.total_value);
    topMap.set(report.supermarket_id, current);
  }

  const topSupermarkets = Array.from(topMap.values())
    .map(item => ({
      ...item,
      name: supermarkets.find(sm => sm.id === item.id)?.name || 'Unknown'
    }))
    .sort((left, right) => right.total_sold - left.total_sold)
    .slice(0, 5);

  const dormantSupermarkets = activeSupermarkets
    .map(sm => {
      const related = deliveries.filter(delivery => delivery.supermarket_id === sm.id);
      const lastDelivery = related.sort((a, b) => (Date.parse(b.delivery_date || 0) || 0) - (Date.parse(a.delivery_date || 0) || 0))[0];
      const daysSince = lastDelivery ? Math.floor((Date.now() - Date.parse(lastDelivery.delivery_date)) / (1000 * 60 * 60 * 24)) : null;
      return {
        id: sm.id,
        name: sm.name,
        last_delivery: lastDelivery?.delivery_date || null,
        days_since: daysSince
      };
    })
    .filter(item => item.days_since === null || item.days_since > 30)
    .sort((left, right) => {
      if (left.days_since === null) return -1;
      if (right.days_since === null) return 1;
      return right.days_since - left.days_since;
    });

  return {
    warehouse: {
      current_qty: toNumber(warehouse.current_qty),
      total_received: toNumber(warehouse.total_received)
    },
    receivables: {
      total: totalReceivables,
      over_limit: activeSupermarkets.filter(sm => toNumber(sm.outstanding) > toNumber(sm.credit_limit)).length,
      near_limit: activeSupermarkets.filter(sm => {
        const outstanding = toNumber(sm.outstanding);
        const creditLimit = toNumber(sm.credit_limit);
        return outstanding > creditLimit * 0.8 && outstanding <= creditLimit;
      }).length
    },
    sales,
    top_supermarkets: topSupermarkets,
    dormant_supermarkets: dormantSupermarkets
  };
}

function applyHeaderStyle(cell) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  cell.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
  cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
}

function autoWidth(sheet) {
  sheet.columns.forEach(col => {
    let max = col.header ? String(col.header).length : 10;
    col.eachCell({ includeEmpty: false }, cell => {
      const value = cell.value !== null && cell.value !== undefined ? String(cell.value) : '';
      if (value.length > max) max = value.length;
    });
    col.width = Math.min(max + 4, 45);
  });
}

function streamToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

function drawHeader(doc, company, docType) {
  doc.rect(0, 0, W, 76).fill(RED);
  doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(17)
    .text(company.name, 40, 16, { width: 340, lineBreak: false });
  doc.fillColor('#FFCCCC').font('Helvetica').fontSize(8.5)
    .text(company.tagline, 40, 38, { width: 340, lineBreak: false });
  doc.fillColor('#FFDDDD').fontSize(8)
    .text(`${company.phone}   |   ${company.address}`, 40, 53, { width: 340, lineBreak: false });
  doc.roundedRect(W - 158, 16, 118, 44, 5).fill(RED2);
  doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(10)
    .text(docType, W - 158, 28, { width: 118, align: 'center', lineBreak: false });
  doc.fillColor(DARK).font('Helvetica').fontSize(10);
  return 88;
}

function drawFooter(doc, company) {
  const fy = doc.page.height - 50;
  doc.moveTo(40, fy).lineTo(W - 40, fy).strokeColor(RULE).lineWidth(0.5).stroke();
  doc.fillColor(LIGHT).font('Helvetica').fontSize(7.5)
    .text(`${company.name}  |  ${company.phone}  |  ${company.address}`,
      40, fy + 8, { width: W - 80, align: 'center', lineBreak: false });
  doc.text('This is a computer-generated document.',
    40, fy + 21, { width: W - 80, align: 'center', lineBreak: false });
}

function sectionBar(doc, text, y) {
  doc.rect(40, y, W - 80, 19).fill(PINK2);
  doc.fillColor(RED).font('Helvetica-Bold').fontSize(8)
    .text(String(text).toUpperCase(), 48, y + 6, { width: W - 96, lineBreak: false });
  return y + 25;
}

function refBar(doc, left, right, y) {
  doc.rect(40, y, W - 80, 26).fill(PINK);
  doc.fillColor(RED).font('Helvetica-Bold').fontSize(12)
    .text(left, 50, y + 7, { lineBreak: false });
  doc.fillColor(MID).font('Helvetica').fontSize(9)
    .text(right, 40, y + 8, { width: W - 80, align: 'right', lineBreak: false });
  return y + 36;
}

function kvRow(doc, label, value, x, y, labelWidth, valueWidth) {
  doc.fillColor(LIGHT).font('Helvetica').fontSize(8.5)
    .text(label, x, y, { width: labelWidth, lineBreak: false });
  doc.fillColor(DARK).font('Helvetica').fontSize(8.5)
    .text(value || '—', x + labelWidth + 4, y, { width: valueWidth, lineBreak: false });
}

function tHead(doc, cols, y) {
  doc.rect(40, y, W - 80, 20).fill(RED);
  doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(8.5);
  cols.forEach(col => {
    doc.text(col.h, col.x, y + 6, { width: col.w, align: col.a || 'left', lineBreak: false });
  });
  return y + 20;
}

function tRow(doc, cols, values, y, shade) {
  if (shade) doc.rect(40, y, W - 80, 20).fill(PINK);
  doc.fillColor(DARK).font('Helvetica').fontSize(8.5);
  cols.forEach((col, index) => {
    doc.text(values[index] || '', col.x, y + 6, { width: col.w, align: col.a || 'left', lineBreak: false });
  });
  return y + 20;
}

function normalizeProductLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map(line => ({ name: String(line?.name || '').trim(), qty: toNumber(line?.qty) }))
    .filter(line => line.name && line.qty > 0);
}

async function getSalesReceiptContext(deliveryId, query = {}) {
  const delivery = await getDeliveryJoined(deliveryId);
  if (!delivery) return null;
  const company = await getCompany();
  const priceRecord = await getCurrentPrice();
  const priceKg = toNumber(priceRecord.price_per_kg) || DEFAULT_PRICE;
  const deliveredQty = toNumber(delivery.qty_delivered);
  const manualAdjustKg = toNumber(query.adjust_kg);
  const baseSold = Math.max(0, deliveredQty + manualAdjustKg);
  let productLines = [];
  if (query.product_lines) {
    try {
      productLines = normalizeProductLines(JSON.parse(String(query.product_lines)));
    } catch {
      productLines = [];
    }
  }
  if (!productLines.length) {
    productLines = [{ name: 'Tsion Parboiled Brown Rice', qty: baseSold }].filter(line => line.qty > 0);
  }
  const soldQty = productLines.reduce((sum, line) => sum + line.qty, 0) || baseSold;
  const fsOverride = String(query.fs_no || '').trim();
  const docDateRaw = String(query.doc_date || '').trim();
  const docDateValue = docDateRaw && !Number.isNaN(Date.parse(docDateRaw)) ? new Date(docDateRaw) : new Date(delivery.delivery_date);
  return {
    company,
    d: delivery,
    priceKg,
    deliveredQty,
    manualAdjustKg,
    soldQty,
    remainingQty: Math.max(0, deliveredQty - soldQty),
    soldVal: soldQty * priceKg,
    outstanding: toNumber(delivery.outstanding),
    adjustNote: String(query.adjust_note || '').trim(),
    receiptFsNumber: fsOverride || delivery.fs_number,
    receiptDateLabel: dateStr(docDateValue),
    productLines,
    bwPrint: ['1', 'true'].includes(String(query.bw || '').toLowerCase())
  };
}

function drawSalesReceiptPage(doc, ctx, isAttachmentPage) {
  const { company, d, priceKg, deliveredQty, manualAdjustKg, soldQty, remainingQty, soldVal, outstanding, adjustNote, receiptFsNumber, receiptDateLabel, productLines, bwPrint } = ctx;
  const PRIMARY = bwPrint ? '#111111' : RED;
  const TINT = bwPrint ? '#F1F1F1' : PINK2;
  const STRIPE = bwPrint ? '#F7F7F7' : PINK;
  const VALUE_BG = bwPrint ? '#141414' : RED;

  let y;
  if (bwPrint) {
    doc.rect(0, 0, W, 70).fill(PRIMARY);
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(16)
      .text(company.name, 40, 15, { width: 360, lineBreak: false });
    doc.fillColor('#E9E9E9').font('Helvetica').fontSize(8)
      .text(`${company.phone}   |   ${company.address}`, 40, 39, { width: 360, lineBreak: false });
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(10)
      .text(isAttachmentPage ? 'SALES RECEIPT ATTACHMENT' : 'SALES RECEIPT', W - 220, 20, { width: 180, align: 'right' });
    y = 82;
    doc.rect(40, y, W - 80, 24).fill('#EFEFEF');
    doc.fillColor('#222').font('Helvetica-Bold').fontSize(9.5)
      .text(`Receipt for: ${receiptFsNumber}`, 50, y + 7, { lineBreak: false });
    doc.fillColor('#444').font('Helvetica').fontSize(8.5)
      .text(`Generated: ${shortDate(new Date())}`, 40, y + 7, { width: W - 90, align: 'right' });
    y += 32;
  } else {
    y = drawHeader(doc, company, isAttachmentPage ? 'SALES RECEIPT ATTACHMENT' : 'SALES RECEIPT');
    y = refBar(doc, `Receipt for: ${receiptFsNumber}`, `Generated: ${shortDate(new Date())}`, y);
  }

  function drawSectionTitle(label, atY) {
    doc.rect(40, atY, W - 80, 18).fill(TINT);
    doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(8.5)
      .text(String(label).toUpperCase(), 48, atY + 5, { width: W - 96, lineBreak: false });
    return atY + 24;
  }

  function drawTableHead(cols, atY) {
    doc.rect(40, atY, W - 80, 19).fill(PRIMARY);
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(8.5);
    cols.forEach(col => {
      doc.text(col.h, col.x, atY + 5, { width: col.w, align: col.a || 'left', lineBreak: false });
    });
    return atY + 19;
  }

  function drawTableRow(cols, vals, atY, shade) {
    if (shade) doc.rect(40, atY, W - 80, 18).fill(STRIPE);
    doc.fillColor(DARK).font('Helvetica').fontSize(8.5);
    cols.forEach((col, index) => {
      doc.text(vals[index] || '', col.x, atY + 5, { width: col.w, align: col.a || 'left', lineBreak: false });
    });
    return atY + 18;
  }

  if (isAttachmentPage) {
    doc.save();
    doc.rotate(-32, { origin: [W / 2, doc.page.height / 2] });
    doc.fillColor(bwPrint ? '#E0E0E0' : '#F3DFDF').font('Helvetica-Bold').fontSize(76)
      .text('ATTACHMENT', W / 2 - 215, doc.page.height / 2 - 18, { lineBreak: false });
    doc.restore();
  }

  y = drawSectionTitle('Supermarket Details', y);
  const smInfo = [
    ['Name', d.supermarket_name], ['Branch', d.supermarket_branch], ['Contact', d.contact_name],
    ['Phone', d.supermarket_phone], ['TIN', d.supermarket_tin], ['Address', d.supermarket_address]
  ];
  smInfo.forEach(([label, value], index) => {
    if (index % 2 === 0) doc.rect(40, y, W - 80, 16).fill(STRIPE);
    kvRow(doc, label, value, 50, y + 4, 80, W - 180);
    y += 16;
  });
  y += 8;

  y = drawSectionTitle('Consignment Summary', y);
  [
    ['Delivery Reference', receiptFsNumber],
    ['Receipt Date', receiptDateLabel],
    ['Qty Delivered', `${fmtNum(deliveredQty)} KG`]
  ].forEach(([label, value], index) => {
    if (index % 2 === 0) doc.rect(40, y, W - 80, 16).fill(STRIPE);
    kvRow(doc, label, value, 50, y + 4, 120, W - 220);
    y += 16;
  });
  y += 8;

  y = drawSectionTitle('Product Breakdown', y);
  const productCols = [
    { h: '#', x: 48, w: 20, a: 'center' },
    { h: 'Product', x: 74, w: 232, a: 'left' },
    { h: 'Qty (KG)', x: 312, w: 70, a: 'right' },
    { h: 'Unit Price', x: 388, w: 74, a: 'right' },
    { h: 'Line Total', x: 468, w: 78, a: 'right' }
  ];
  y = drawTableHead(productCols, y);
  productLines.forEach((line, index) => {
    y = drawTableRow(productCols, [String(index + 1), line.name, fmtNum(line.qty), birr(priceKg), birr(line.qty * priceKg)], y, index % 2 === 0);
  });
  y += 6;

  y = drawSectionTitle('Sales & Financial Summary', y);
  const financeCols = [
    { h: 'Description', x: 48, w: 300, a: 'left' },
    { h: 'Value', x: 390, w: 156, a: 'right' }
  ];
  y = drawTableHead(financeCols, y);
  [
    ['Delivered Quantity', `${fmtNum(deliveredQty)} KG`],
    ['Default Sold Assumption', `${fmtNum(deliveredQty)} KG`],
    ['Manual Adjustment (+/-)', `${fmtNum(manualAdjustKg)} KG`],
    ['Final Sold Quantity', `${fmtNum(soldQty)} KG`],
    ['Remaining Quantity', `${fmtNum(remainingQty)} KG`],
    ['Selling Price per KG', birr(priceKg)],
    ['Gross Sales Value', birr(soldVal)]
  ].forEach(([label, value], index) => {
    y = drawTableRow(financeCols, [label, value], y, index % 2 === 0);
  });

  if (adjustNote) {
    y += 6;
    doc.fillColor(MID).font('Helvetica').fontSize(8.5)
      .text(`Adjustment note: ${adjustNote}`, 40, y, { width: W - 80 });
    y = doc.y + 8;
  }

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

  drawFooter(doc, company);
}

async function sendPdf(res, name, drawFn) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
  const bufferPromise = streamToBuffer(doc);
  await drawFn(doc);
  doc.end();
  const buffer = await bufferPromise;
  await persistGeneratedFile(name, buffer, 'application/pdf');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"`);
  res.setHeader('Content-Length', String(buffer.length));
  res.send(buffer);
}

async function sendWorkbook(res, workbook, name) {
  const rawBuffer = await workbook.xlsx.writeBuffer();
  const buffer = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer);
  await persistGeneratedFile(name, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"`);
  res.setHeader('Content-Length', String(buffer.length));
  res.send(buffer);
}

app.get('/api/health', async (req, res) => {
  res.json({ status: 'ok', time: nowIso(), service: 'Tsion ERP Firebase API' });
});

app.get('/api/meta/company', async (req, res, next) => {
  try {
    res.json(await getCompany());
  } catch (error) {
    next(error);
  }
});

app.get('/api/supermarkets', async (req, res, next) => {
  try {
    const rows = await listSupermarketsWithComputed(req.query);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.get('/api/supermarkets/:id', async (req, res, next) => {
  try {
    const supermarket = await getDoc('supermarkets', req.params.id);
    if (!supermarket) return res.status(404).json({ error: 'Not found' });
    const [deliveries, payments] = await Promise.all([
      listDeliveriesJoined({ supermarket_id: req.params.id }),
      listPaymentsJoined({ supermarket_id: req.params.id })
    ]);
    res.json({ ...supermarket, deliveries, payments });
  } catch (error) {
    next(error);
  }
});

app.post('/api/supermarkets', async (req, res, next) => {
  try {
    const { name, branch, tin, contact_name, phone, email, address, lat, lng, credit_limit, status, payment_terms } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const created = await firestore.runTransaction(async transaction => {
      const seq = await nextCounter(transaction, 'supermarket_code_seq');
      const ref = firestore.collection('supermarkets').doc();
      const payload = {
        code: `SM${String(seq).padStart(3, '0')}`,
        name,
        branch: branch || '',
        tin: tin || '',
        contact_name: contact_name || '',
        phone: phone || '',
        email: email || '',
        address: address || '',
        lat: lat === '' || lat === undefined || lat === null ? null : Number(lat),
        lng: lng === '' || lng === undefined || lng === null ? null : Number(lng),
        credit_limit: toNumber(credit_limit || 20000),
        outstanding: 0,
        status: status || 'Active',
        payment_terms: payment_terms || 'Consignment',
        created_at: nowIso(),
        updated_at: nowIso()
      };
      transaction.set(ref, payload);
      return { id: ref.id, ...payload };
    });

    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

app.put('/api/supermarkets/:id', async (req, res, next) => {
  try {
    const ref = firestore.collection('supermarkets').doc(req.params.id);
    const snapshot = await ref.get();
    if (!snapshot.exists) return res.status(404).json({ error: 'Not found' });
    const existing = snapshot.data();
    const payload = {
      code: existing.code,
      outstanding: toNumber(existing.outstanding),
      payment_terms: existing.payment_terms || 'Consignment',
      created_at: existing.created_at || nowIso(),
      updated_at: nowIso(),
      name: req.body.name,
      branch: req.body.branch || '',
      tin: req.body.tin || '',
      contact_name: req.body.contact_name || '',
      phone: req.body.phone || '',
      email: req.body.email || '',
      address: req.body.address || '',
      lat: req.body.lat === '' || req.body.lat === undefined || req.body.lat === null ? null : Number(req.body.lat),
      lng: req.body.lng === '' || req.body.lng === undefined || req.body.lng === null ? null : Number(req.body.lng),
      credit_limit: toNumber(req.body.credit_limit),
      status: req.body.status || 'Active'
    };
    await ref.set(payload);
    res.json({ id: ref.id, ...payload });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/supermarkets/:id', async (req, res, next) => {
  try {
    const [deliveries, payments] = await Promise.all([
      getAll('deliveries'),
      getAll('payments')
    ]);
    if (deliveries.some(item => item.supermarket_id === req.params.id) || payments.some(item => item.supermarket_id === req.params.id)) {
      return res.status(400).json({ error: 'Cannot delete supermarket with related deliveries or payments' });
    }
    await firestore.collection('supermarkets').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/inventory/summary', async (req, res, next) => {
  try {
    res.json(await getInventorySummaryData());
  } catch (error) {
    next(error);
  }
});

app.get('/api/inventory/transactions', async (req, res, next) => {
  try {
    const rows = sortByNewest(await getAll('inventory_transactions'), 'transaction_date');
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post('/api/inventory/stock-in', async (req, res, next) => {
  try {
    const qty = toNumber(req.body.qty);
    if (qty <= 0) return res.status(400).json({ error: 'Invalid quantity' });
    const note = req.body.note || '';
    const transactionDate = req.body.transaction_date || today();
    const result = await firestore.runTransaction(async transaction => {
      const stockRef = firestore.collection('settings').doc('warehouse_stock');
      const stockSnap = await transaction.get(stockRef);
      const stock = stockSnap.exists ? stockSnap.data() : { current_qty: 0, total_received: 0 };
      const txnRef = firestore.collection('inventory_transactions').doc();
      const ref = `INV-${Date.now()}`;
      transaction.set(txnRef, {
        ref,
        type: 'stock_in',
        qty,
        note,
        transaction_date: transactionDate,
        created_at: nowIso()
      });
      transaction.set(stockRef, {
        current_qty: toNumber(stock.current_qty) + qty,
        total_received: toNumber(stock.total_received) + qty,
        updated_at: nowIso()
      }, { merge: true });
      return { ref };
    });
    res.status(201).json({ success: true, ref: result.ref, stock: await getWarehouseStock() });
  } catch (error) {
    next(error);
  }
});

app.get('/api/inventory/price', async (req, res, next) => {
  try {
    res.json(await getCurrentPrice());
  } catch (error) {
    next(error);
  }
});

app.post('/api/inventory/price', async (req, res, next) => {
  try {
    const pricePerKg = toNumber(req.body.price_per_kg);
    if (pricePerKg <= 0) return res.status(400).json({ error: 'Invalid price' });
    const payload = {
      price_per_kg: pricePerKg,
      effective_date: req.body.effective_date || today(),
      notes: req.body.notes || '',
      created_at: nowIso()
    };
    const ref = firestore.collection('pricing').doc();
    await ref.set(payload);
    await setSetting('current_price', payload);
    res.status(201).json({ id: ref.id, ...payload });
  } catch (error) {
    next(error);
  }
});

app.get('/api/deliveries', async (req, res, next) => {
  try {
    res.json(await listDeliveriesJoined(req.query));
  } catch (error) {
    next(error);
  }
});

app.get('/api/deliveries/:id', async (req, res, next) => {
  try {
    const delivery = await getDeliveryJoined(req.params.id);
    if (!delivery) return res.status(404).json({ error: 'Not found' });
    res.json(delivery);
  } catch (error) {
    next(error);
  }
});

app.post('/api/deliveries', async (req, res, next) => {
  try {
    const supermarketId = req.body.supermarket_id;
    const qtyDelivered = toNumber(req.body.qty_delivered);
    if (!supermarketId || qtyDelivered <= 0) {
      return res.status(400).json({ error: 'supermarket_id and qty_delivered are required' });
    }

    const created = await firestore.runTransaction(async transaction => {
      const stockRef = firestore.collection('settings').doc('warehouse_stock');
      const supermarketRef = firestore.collection('supermarkets').doc(supermarketId);
      const counterRef = firestore.collection('settings').doc('counters');
      const stockSnap = await transaction.get(stockRef);
      const supermarketSnap = await transaction.get(supermarketRef);
      const counterSnap = await transaction.get(counterRef);
      if (!supermarketSnap.exists) throw new Error('Supermarket not found');
      const stock = stockSnap.exists ? stockSnap.data() : { current_qty: 0, total_received: 0 };
      if (toNumber(stock.current_qty) < qtyDelivered) {
        throw new Error(`Insufficient warehouse stock. Available: ${toNumber(stock.current_qty)} KG`);
      }
      const counters = counterSnap.exists ? counterSnap.data() : {};
      const nextFsSeq = toNumber(counters.delivery_fs_seq) + 1;
      transaction.set(counterRef, { delivery_fs_seq: nextFsSeq, updated_at: nowIso() }, { merge: true });
      const fsNumber = `FS-${String(nextFsSeq).padStart(4, '0')}`;
      const deliveryRef = firestore.collection('deliveries').doc();
      const payload = {
        fs_number: fsNumber,
        supermarket_id: supermarketId,
        qty_delivered: qtyDelivered,
        qty_sold: 0,
        qty_returned: 0,
        delivery_date: req.body.delivery_date || today(),
        driver: req.body.driver || null,
        notes: req.body.notes || null,
        status: 'Delivered',
        created_at: nowIso(),
        updated_at: nowIso()
      };
      transaction.set(deliveryRef, payload);
      const inventoryRef = firestore.collection('inventory_transactions').doc();
      transaction.set(inventoryRef, {
        ref: `INV-${Date.now()}`,
        type: 'stock_out',
        qty: qtyDelivered,
        note: `Delivery ${fsNumber}`,
        delivery_id: deliveryRef.id,
        transaction_date: req.body.delivery_date || today(),
        created_at: nowIso()
      });
      transaction.set(stockRef, {
        current_qty: toNumber(stock.current_qty) - qtyDelivered,
        total_received: toNumber(stock.total_received),
        updated_at: nowIso()
      }, { merge: true });
      return { id: deliveryRef.id, ...payload };
    });

    const full = await getDeliveryJoined(created.id);
    res.status(201).json(full);
  } catch (error) {
    if (error.message === 'Supermarket not found') return res.status(404).json({ error: error.message });
    if (error.message.startsWith('Insufficient warehouse stock')) return res.status(400).json({ error: error.message });
    next(error);
  }
});

app.patch('/api/deliveries/:id/sales', async (req, res, next) => {
  try {
    const qtySold = toNumber(req.body.qty_sold);
    const qtyReturned = toNumber(req.body.qty_returned);
    const notes = req.body.notes || null;
    const updated = await firestore.runTransaction(async transaction => {
      const deliveryRef = firestore.collection('deliveries').doc(req.params.id);
      const deliverySnap = await transaction.get(deliveryRef);
      if (!deliverySnap.exists) throw new Error('Delivery not found');
      const delivery = { id: deliverySnap.id, ...deliverySnap.data() };
      const total = qtySold + qtyReturned;
      if (total > toNumber(delivery.qty_delivered)) {
        throw new Error('Sold + returned cannot exceed delivered quantity');
      }
      const supermarketRef = firestore.collection('supermarkets').doc(delivery.supermarket_id);
      const supermarketSnap = await transaction.get(supermarketRef);
      const supermarket = supermarketSnap.exists ? supermarketSnap.data() : null;
      if (!supermarket) throw new Error('Supermarket not found');
      const priceRef = firestore.collection('settings').doc('current_price');
      const priceSnap = await transaction.get(priceRef);
      const price = priceSnap.exists ? priceSnap.data() : { price_per_kg: DEFAULT_PRICE };
      const pricePerKg = toNumber(price.price_per_kg) || DEFAULT_PRICE;
      const additionalSold = qtySold - toNumber(delivery.qty_sold);
      const additionalReturned = qtyReturned - toNumber(delivery.qty_returned);
      transaction.set(deliveryRef, {
        ...delivery,
        qty_sold: qtySold,
        qty_returned: qtyReturned,
        updated_at: nowIso()
      });
      if (additionalSold > 0) {
        const reportRef = firestore.collection('sales_reports').doc();
        transaction.set(reportRef, {
          delivery_id: delivery.id,
          supermarket_id: delivery.supermarket_id,
          qty_sold: additionalSold,
          price_per_kg: pricePerKg,
          total_value: additionalSold * pricePerKg,
          report_date: today(),
          notes,
          created_at: nowIso()
        });
        transaction.set(supermarketRef, {
          ...supermarket,
          outstanding: toNumber(supermarket.outstanding) + additionalSold * pricePerKg,
          updated_at: nowIso()
        });
      }
      if (additionalReturned > 0) {
        const stockRef = firestore.collection('settings').doc('warehouse_stock');
        const stockSnap = await transaction.get(stockRef);
        const stock = stockSnap.exists ? stockSnap.data() : { current_qty: 0, total_received: 0 };
        const inventoryRef = firestore.collection('inventory_transactions').doc();
        transaction.set(inventoryRef, {
          ref: `RET-${Date.now()}`,
          type: 'return',
          qty: additionalReturned,
          note: `Return from delivery ${delivery.fs_number}`,
          delivery_id: delivery.id,
          transaction_date: today(),
          created_at: nowIso()
        });
        transaction.set(stockRef, {
          current_qty: toNumber(stock.current_qty) + additionalReturned,
          total_received: toNumber(stock.total_received),
          updated_at: nowIso()
        }, { merge: true });
      }
      return delivery.id;
    });
    res.json(await getDeliveryJoined(updated));
  } catch (error) {
    if (error.message === 'Delivery not found') return res.status(404).json({ error: error.message });
    if (error.message === 'Supermarket not found' || error.message === 'Sold + returned cannot exceed delivered quantity') {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

app.get('/api/payments', async (req, res, next) => {
  try {
    res.json(await listPaymentsJoined(req.query));
  } catch (error) {
    next(error);
  }
});

app.post('/api/payments', async (req, res, next) => {
  try {
    const supermarketId = req.body.supermarket_id;
    const amount = toNumber(req.body.amount);
    if (!supermarketId || amount <= 0) {
      return res.status(400).json({ error: 'supermarket_id and amount are required' });
    }
    const paymentId = await firestore.runTransaction(async transaction => {
      const supermarketRef = firestore.collection('supermarkets').doc(supermarketId);
      const supermarketSnap = await transaction.get(supermarketRef);
      const countersRef = firestore.collection('settings').doc('counters');
      const countersSnap = await transaction.get(countersRef);
      if (!supermarketSnap.exists) throw new Error('Supermarket not found');
      const supermarket = supermarketSnap.data();
      const outstanding = toNumber(supermarket.outstanding);
      if (outstanding <= 0) throw new Error('No outstanding balance for this supermarket');
      if (amount > outstanding) throw new Error(`Payment exceeds outstanding balance (${outstanding.toFixed(2)})`);
      const nextRefSeq = toNumber(countersSnap.exists ? countersSnap.data().payment_ref_seq : 0) + 1;
      transaction.set(countersRef, { payment_ref_seq: nextRefSeq, updated_at: nowIso() }, { merge: true });
      const paymentRef = firestore.collection('payments').doc();
      const payment = {
        ref: `PAY-${String(nextRefSeq).padStart(3, '0')}`,
        supermarket_id: supermarketId,
        amount,
        payment_date: req.body.payment_date || today(),
        method: req.body.method || 'Bank Transfer',
        reference_no: req.body.reference_no || null,
        notes: req.body.notes || null,
        created_at: nowIso()
      };
      transaction.set(paymentRef, payment);
      transaction.set(supermarketRef, {
        ...supermarket,
        outstanding: outstanding - amount,
        updated_at: nowIso()
      });
      return paymentRef.id;
    });
    const payments = await listPaymentsJoined({});
    const payment = payments.find(item => item.id === paymentId);
    res.status(201).json(payment);
  } catch (error) {
    if (['Supermarket not found', 'No outstanding balance for this supermarket'].includes(error.message) || error.message.startsWith('Payment exceeds outstanding balance')) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

app.get('/api/reports/dashboard', async (req, res, next) => {
  try {
    res.json(await getDashboardData());
  } catch (error) {
    next(error);
  }
});

app.get('/api/reports/aging', async (req, res, next) => {
  try {
    const [supermarkets, payments, deliveries] = await Promise.all([
      getAll('supermarkets'),
      getAll('payments'),
      getAll('deliveries')
    ]);
    const rows = supermarkets
      .filter(item => item.status === 'Active')
      .map(sm => {
        const relatedPayments = payments.filter(payment => payment.supermarket_id === sm.id);
        const relatedDeliveries = deliveries.filter(delivery => delivery.supermarket_id === sm.id);
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        return {
          name: sm.name,
          code: sm.code,
          outstanding: toNumber(sm.outstanding),
          credit_limit: toNumber(sm.credit_limit),
          paid_last_7: relatedPayments
            .filter(payment => (Date.parse(payment.payment_date || 0) || 0) >= sevenDaysAgo)
            .reduce((sum, payment) => sum + toNumber(payment.amount), 0),
          last_payment_date: sortByNewest(relatedPayments, 'payment_date')[0]?.payment_date || null,
          last_delivery_date: sortByNewest(relatedDeliveries, 'delivery_date')[0]?.delivery_date || null
        };
      })
      .sort((left, right) => right.outstanding - left.outstanding);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

function periodStart(value, period) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  if (period === 'daily') return date.toISOString();
  if (period === 'weekly') {
    const day = date.getDay();
    const diff = (day + 6) % 7;
    date.setDate(date.getDate() - diff);
    return date.toISOString();
  }
  date.setDate(1);
  return date.toISOString();
}

app.get('/api/reports/sales-trend', async (req, res, next) => {
  try {
    const period = ['daily', 'weekly', 'monthly'].includes(req.query.period) ? req.query.period : 'monthly';
    const reports = await getAll('sales_reports');
    const grouped = new Map();
    for (const report of reports) {
      const key = periodStart(report.report_date || report.created_at || nowIso(), period);
      const current = grouped.get(key) || { period: key, qty_sold: 0, revenue: 0, supermarketIds: new Set() };
      current.qty_sold += toNumber(report.qty_sold);
      current.revenue += toNumber(report.total_value);
      current.supermarketIds.add(report.supermarket_id);
      grouped.set(key, current);
    }
    const rows = Array.from(grouped.values())
      .map(item => ({
        period: item.period,
        qty_sold: item.qty_sold,
        revenue: item.revenue,
        active_supermarkets: item.supermarketIds.size
      }))
      .sort((left, right) => (Date.parse(right.period) || 0) - (Date.parse(left.period) || 0))
      .slice(0, 12);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.get('/api/uploads/attachments', async (req, res, next) => {
  try {
    const files = await listStorageFiles('uploads/attachments');
    res.json(files.map(item => fileToResponse(item.fileName, item.metadata)));
  } catch (error) {
    next(error);
  }
});

app.get('/api/uploads/attachments/:fileName', async (req, res, next) => {
  try {
    const fileName = String(req.params.fileName || '').split('/').pop();
    const ok = await streamStorageFile(res, storageKey('uploads/attachments', fileName), 'application/octet-stream', fileName, true);
    if (!ok) return res.status(404).json({ error: 'Attachment not found' });
  } catch (error) {
    next(error);
  }
});

app.post('/api/uploads/attachments', upload.single('attachment'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Attachment file is required' });
    const ext = (req.file.originalname.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    const fileName = `${Date.now()}__${uuidv4()}__${sanitizeBaseName(req.file.originalname)}${ext}`;
    await saveStorageBuffer(storageKey('uploads/attachments', fileName), req.file.buffer, req.file.mimetype || 'application/octet-stream');
    res.status(201).json(fileToResponse(fileName, {
      size: req.file.size,
      updated: nowIso()
    }));
  } catch (error) {
    next(error);
  }
});

app.get('/api/pdf/delivery-note/:deliveryId', async (req, res, next) => {
  try {
    const delivery = await getDeliveryJoined(req.params.deliveryId);
    if (!delivery) return res.status(404).json({ error: 'Delivery not found' });
    const company = await getCompany();
    const priceRecord = await getCurrentPrice();
    const priceKg = toNumber(priceRecord.price_per_kg) || DEFAULT_PRICE;
    const totalVal = toNumber(delivery.qty_delivered) * priceKg;
    const name = `delivery-note-${delivery.fs_number}.pdf`;

    await sendPdf(res, name, async doc => {
      let y = drawHeader(doc, company, 'DELIVERY NOTE');
      y = refBar(doc, `FS#: ${delivery.fs_number}`, `Delivery date: ${dateStr(delivery.delivery_date)}`, y);
      const boxWidth = Math.floor((W - 92) / 2);
      const boxHeight = 98;
      doc.rect(40, y, boxWidth, boxHeight).lineWidth(0.5).stroke(RULE);
      doc.rect(40, y, boxWidth, 17).fill(PINK2);
      doc.fillColor(RED).font('Helvetica-Bold').fontSize(8).text('FROM — SUPPLIER', 48, y + 5, { lineBreak: false });
      let leftY = y + 24;
      kvRow(doc, 'Company', company.name, 48, leftY, 60, boxWidth - 76); leftY += 14;
      kvRow(doc, 'Phone', company.phone, 48, leftY, 60, boxWidth - 76); leftY += 14;
      kvRow(doc, 'Address', company.address, 48, leftY, 60, boxWidth - 76); leftY += 14;
      if (company.tin) kvRow(doc, 'TIN', company.tin, 48, leftY, 60, boxWidth - 76);

      const rightX = 52 + boxWidth;
      doc.rect(rightX, y, boxWidth, boxHeight).lineWidth(0.5).stroke(RULE);
      doc.rect(rightX, y, boxWidth, 17).fill(PINK2);
      doc.fillColor(RED).font('Helvetica-Bold').fontSize(8).text('TO — RECIPIENT', rightX + 8, y + 5, { lineBreak: false });
      let rightY = y + 24;
      kvRow(doc, 'Supermarket', delivery.supermarket_name, rightX + 8, rightY, 68, boxWidth - 84); rightY += 14;
      kvRow(doc, 'Branch', delivery.supermarket_branch, rightX + 8, rightY, 68, boxWidth - 84); rightY += 14;
      kvRow(doc, 'Contact', delivery.contact_name, rightX + 8, rightY, 68, boxWidth - 84); rightY += 14;
      kvRow(doc, 'Phone', delivery.supermarket_phone, rightX + 8, rightY, 68, boxWidth - 84); rightY += 14;
      kvRow(doc, 'TIN', delivery.supermarket_tin || '—', rightX + 8, rightY, 68, boxWidth - 84); rightY += 14;
      kvRow(doc, 'Address', delivery.supermarket_address, rightX + 8, rightY, 68, boxWidth - 84);
      y += boxHeight + 14;
      y = sectionBar(doc, 'Goods Delivered', y);
      const cols = [
        { h: '#', x: 48, w: 20, a: 'center' },
        { h: 'Description', x: 76, w: 244, a: 'left' },
        { h: 'Qty (KG)', x: 326, w: 64, a: 'right' },
        { h: 'Unit Price', x: 396, w: 74, a: 'right' },
        { h: 'Total', x: 476, w: 70, a: 'right' }
      ];
      y = tHead(doc, cols, y);
      y = tRow(doc, cols, ['1', 'Tsion Parboiled Brown Rice (1 KG bags)', fmtNum(delivery.qty_delivered), birr(priceKg), birr(totalVal)], y, true);
      doc.rect(40, y, W - 80, 24).fill(PINK2);
      doc.moveTo(40, y).lineTo(W - 40, y).strokeColor(RED).lineWidth(0.5).stroke();
      doc.fillColor(RED).font('Helvetica-Bold').fontSize(10).text('TOTAL VALUE', 48, y + 7, { lineBreak: false });
      doc.fillColor(RED).font('Helvetica-Bold').fontSize(11).text(birr(totalVal), 476, y + 6, { width: 70, align: 'right', lineBreak: false });
      y += 30;
      doc.fillColor(LIGHT).font('Helvetica').fontSize(8)
        .text('Payment terms: Consignment — payment upon submission of sale report.', 40, y, { lineBreak: false });
      y += 16;
      if (delivery.notes) {
        doc.fillColor(DARK).font('Helvetica').fontSize(9).text(`Notes: ${delivery.notes}`, 40, y);
        y += 16;
      }
      y = Math.min(y + 18, doc.page.height - 115);
      ['Delivered by (Name & Signature)', 'Received by (Name & Signature)'].forEach((label, index) => {
        const startX = index === 0 ? 40 : W - 200;
        doc.moveTo(startX, y + 34).lineTo(startX + 160, y + 34).strokeColor(DARK).lineWidth(0.5).stroke();
        doc.fillColor(LIGHT).font('Helvetica').fontSize(7.5).text(label, startX, y + 38, { width: 160, lineBreak: false });
        doc.text('Date: _____________________', startX, y + 51, { width: 160, lineBreak: false });
      });
      drawFooter(doc, company);
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/pdf/sales-receipt/:deliveryId', async (req, res, next) => {
  try {
    const ctx = await getSalesReceiptContext(req.params.deliveryId, req.query);
    if (!ctx) return res.status(404).json({ error: 'Delivery not found' });
    await sendPdf(res, `sales-receipt-${ctx.d.fs_number}.pdf`, async doc => {
      drawSalesReceiptPage(doc, ctx, false);
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/pdf/sales-receipt-attachment/:deliveryId', async (req, res, next) => {
  try {
    const ctx = await getSalesReceiptContext(req.params.deliveryId, req.query);
    if (!ctx) return res.status(404).json({ error: 'Delivery not found' });
    await sendPdf(res, `sales-receipt-attachment-${ctx.d.fs_number}.pdf`, async doc => {
      drawSalesReceiptPage(doc, ctx, true);
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/pdf/price-change-letter', async (req, res, next) => {
  try {
    const { new_price, effective_date, message_body, supermarket_ids } = req.body;
    const newPrice = toNumber(new_price);
    if (newPrice <= 0 || !effective_date) return res.status(400).json({ error: 'new_price and effective_date are required' });
    const company = await getCompany();
    const [currentPrice, supermarkets] = await Promise.all([
      getCurrentPrice(),
      getAll('supermarkets')
    ]);
    const recipients = (Array.isArray(supermarket_ids) && supermarket_ids.length
      ? supermarkets.filter(sm => supermarket_ids.includes(sm.id))
      : supermarkets.filter(sm => sm.status === 'Active'))
      .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));
    const ref = `PCL-${Date.now()}`;
    const name = `price-change-letter-${ref}.pdf`;
    await sendPdf(res, name, async doc => {
      recipients.forEach((sm, index) => {
        if (index > 0) doc.addPage();
        doc.rect(0, 0, W, 76).fill(RED);
        doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(17).text(company.name, 60, 14, { width: 360, lineBreak: false });
        doc.fillColor('#FFCCCC').font('Helvetica').fontSize(8.5).text(company.tagline, 60, 37, { lineBreak: false });
        doc.fillColor('#FFDDDD').fontSize(8).text(`${company.phone}   |   ${company.address}`, 60, 52, { lineBreak: false });
        doc.fillColor(WHITE).font('Helvetica').fontSize(8)
          .text(`Ref: ${ref}`, W - 190, 18, { width: 150, align: 'right', lineBreak: false })
          .text(`Date: ${dateStr(new Date())}`, W - 190, 32, { width: 150, align: 'right', lineBreak: false });
        let y = 96;
        doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10.5).text(sm.name, 60, y); y += 16;
        doc.font('Helvetica').fontSize(9.5);
        if (sm.branch) { doc.fillColor(DARK).text(sm.branch, 60, y); y += 13; }
        if (sm.address) { doc.fillColor(DARK).text(sm.address, 60, y); y += 13; }
        if (sm.contact_name) { doc.fillColor(MID).text(`Attn: ${sm.contact_name}`, 60, y); y += 13; }
        y += 10;
        doc.moveTo(60, y).lineTo(W - 60, y).strokeColor(RED).lineWidth(1).stroke(); y += 8;
        doc.fillColor(RED).font('Helvetica-Bold').fontSize(12).text('SUBJECT: PRICE ADJUSTMENT NOTICE', 60, y, { width: W - 120 }); y += 18;
        doc.fillColor(MID).font('Helvetica').fontSize(9).text(`Effective from: ${dateStr(effective_date)}`, 60, y, { lineBreak: false }); y += 8;
        doc.moveTo(60, y).lineTo(W - 60, y).strokeColor(RED).lineWidth(0.5).stroke(); y += 14;
        doc.fillColor(DARK).font('Helvetica').fontSize(10).text(`Dear ${sm.contact_name || 'Valued Partner'},`, 60, y); y += 18;
        const body = message_body || `We would like to inform you that ${company.name} will be revising the selling price of our Parboiled Brown Rice, effective ${dateStr(effective_date)}.\n\nThis adjustment reflects recent changes in production and logistics costs. We remain committed to delivering the highest quality product and to maintaining our valued partnership with your business.\n\nWe appreciate your continued trust and support. Please do not hesitate to contact us if you have any questions.`;
        doc.font('Helvetica').fontSize(10).fillColor(DARK).text(body, 60, y, { width: W - 120, align: 'justify' });
        y = doc.y + 18;
        const boxHeight = 82;
        doc.rect(60, y, W - 120, boxHeight).lineWidth(0.5).stroke(RULE);
        doc.rect(60, y, W - 120, 19).fill(PINK2);
        doc.fillColor(RED).font('Helvetica-Bold').fontSize(8.5).text('PRICE SUMMARY', 60, y + 6, { width: W - 120, align: 'center', lineBreak: false });
        let priceY = y + 27;
        doc.fillColor(LIGHT).font('Helvetica').fontSize(9).text('Current price per KG:', 80, priceY, { lineBreak: false });
        doc.fillColor(DARK).font('Helvetica').fontSize(9).text(birr(currentPrice.price_per_kg), W - 140, priceY, { width: 80, align: 'right', lineBreak: false });
        priceY += 16;
        doc.fillColor(LIGHT).font('Helvetica').fontSize(9).text('New price per KG:', 80, priceY, { lineBreak: false });
        doc.fillColor(RED).font('Helvetica-Bold').fontSize(12).text(birr(newPrice), W - 140, priceY - 1, { width: 80, align: 'right', lineBreak: false });
        priceY += 18;
        doc.fillColor(LIGHT).font('Helvetica').fontSize(8).text(`Effective from: ${dateStr(effective_date)}`, 80, priceY, { lineBreak: false });
        y += boxHeight + 20;
        doc.fillColor(DARK).font('Helvetica').fontSize(10).text('Thank you for your understanding and continued partnership.', 60, y, { width: W - 120 });
        y = doc.y + 14;
        doc.text('Sincerely,', 60, y); y += 38;
        doc.moveTo(60, y).lineTo(220, y).strokeColor(DARK).lineWidth(0.5).stroke(); y += 5;
        doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10).text(company.name, 60, y); y += 14;
        doc.fillColor(LIGHT).font('Helvetica').fontSize(8.5).text('Authorized Signatory', 60, y);
        drawFooter(doc, company);
      });
    });
    await firestore.collection('price_letters').doc().set({
      ref,
      new_price: newPrice,
      effective_date,
      message_body: message_body || '',
      sent_to: recipients.map(item => item.name),
      created_at: nowIso()
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/pdf/delivery-order', async (req, res, next) => {
  try {
    const supermarketId = req.body.supermarket_id;
    const qty = toNumber(req.body.qty);
    if (!supermarketId || qty <= 0) return res.status(400).json({ error: 'supermarket_id and qty required' });
    const [supermarket, company, price] = await Promise.all([
      getDoc('supermarkets', supermarketId),
      getCompany(),
      getCurrentPrice()
    ]);
    if (!supermarket) return res.status(404).json({ error: 'Supermarket not found' });
    const priceKg = toNumber(price.price_per_kg) || DEFAULT_PRICE;
    const totalVal = qty * priceKg;
    const ref = `DO-${Date.now()}`;
    const name = `delivery-order-${ref}.pdf`;
    await sendPdf(res, name, async doc => {
      const pageHeight = doc.page.height;
      const cutY = Math.floor(pageHeight / 2);
      const left = 24;
      const width = W - 48;
      function drawHalf(topY, copyLabel) {
        const halfHeight = cutY - 32;
        const right = left + width;
        let y = topY + 10;
        doc.rect(left, topY, width, halfHeight).lineWidth(0.8).stroke(RULE);
        doc.rect(left, y, width, 26).fill(RED);
        doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(11.5).text('OFFICIAL DELIVERY RECEIPT', left + 10, y + 7, { width: width - 160, lineBreak: false });
        doc.font('Helvetica-Bold').fontSize(8.5).text(String(copyLabel).toUpperCase(), right - 146, y + 8, { width: 136, align: 'right', lineBreak: false });
        y += 34;
        doc.fillColor(DARK).font('Helvetica').fontSize(8.8)
          .text(`Ref: ${ref}   |   Issued: ${shortDate(new Date())}   |   Delivery Date: ${dateStr(req.body.delivery_date || new Date())}`,
            left + 10, y, { width: width - 20 });
        y += 18;
        const rows = [
          ['Supplier', company.name],
          ['Recipient', supermarket.name + (supermarket.branch ? ` — ${supermarket.branch}` : '')],
          ['Address', supermarket.address || '—'],
          ['Recipient Contact', (supermarket.contact_name || '—') + (supermarket.phone ? ` · ${supermarket.phone}` : '')],
          ['Assigned Driver', req.body.driver || 'TBD'],
          ['Product', 'Tsion Parboiled Brown Rice (1 KG bags)'],
          ['Quantity', `${fmtNum(qty)} KG`],
          ['Price / KG', birr(priceKg)],
          ['Estimated Value', birr(totalVal)]
        ];
        rows.forEach(([label, value], index) => {
          if (index % 2 === 0) doc.rect(left + 6, y, width - 12, 14).fill(PINK);
          kvRow(doc, label, value, left + 12, y + 3, 88, width - 118);
          y += 14;
        });
        if (req.body.notes) {
          doc.fillColor(MID).font('Helvetica').fontSize(8).text(`Note: ${req.body.notes}`, left + 12, y + 4, { width: width - 24, lineBreak: false });
        }
        const signY = topY + halfHeight - 46;
        const sigW = Math.floor((width - 40) / 2);
        const leftX = left + 12;
        const rightX = leftX + sigW + 16;
        doc.moveTo(leftX, signY).lineTo(leftX + sigW, signY).strokeColor(DARK).lineWidth(0.5).stroke();
        doc.moveTo(rightX, signY).lineTo(rightX + sigW, signY).strokeColor(DARK).lineWidth(0.5).stroke();
        doc.fillColor(LIGHT).font('Helvetica').fontSize(7.5).text('Issued / Released By (Name & Signature)', leftX, signY + 4, { width: sigW });
        doc.text('Received By (Name & Signature)', rightX, signY + 4, { width: sigW });
        doc.text('Date: ____________', leftX, signY + 16, { width: sigW, lineBreak: false });
        doc.text('Date: ____________', rightX, signY + 16, { width: sigW, lineBreak: false });
      }
      drawHalf(16, 'Warehouse Copy');
      doc.moveTo(left, cutY).lineTo(W - left, cutY).strokeColor(RULE).lineWidth(0.7).stroke();
      drawHalf(cutY + 14, 'Outlet Copy');
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/export/supermarkets', async (req, res, next) => {
  try {
    const rows = await listSupermarketsWithComputed({});
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Tsion ERP Firebase';
    const sheet = workbook.addWorksheet('Supermarkets');
    sheet.columns = [
      { header: 'Code', key: 'code' },
      { header: 'Name', key: 'name' },
      { header: 'Branch', key: 'branch' },
      { header: 'TIN', key: 'tin' },
      { header: 'Contact', key: 'contact_name' },
      { header: 'Phone', key: 'phone' },
      { header: 'Email', key: 'email' },
      { header: 'Address', key: 'address' },
      { header: 'Credit Limit', key: 'credit_limit', style: { numFmt: '#,##0.00' } },
      { header: 'Outstanding (ETB)', key: 'outstanding', style: { numFmt: '#,##0.00' } },
      { header: 'Consignment Stock (KG)', key: 'consignment_stock', style: { numFmt: '#,##0' } },
      { header: 'Status', key: 'status' },
      { header: 'Payment Terms', key: 'payment_terms' },
      { header: 'Created At', key: 'created_at' }
    ];
    sheet.getRow(1).eachCell(applyHeaderStyle);
    rows.forEach((row, index) => {
      const added = sheet.addRow(row);
      added.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 === 0 ? 'FFFFFFFF' : 'FFFFF8F8' } };
    });
    autoWidth(sheet);
    await sendWorkbook(res, workbook, `tsion-supermarkets-${Date.now()}.xlsx`);
  } catch (error) {
    next(error);
  }
});

app.get('/api/export/deliveries', async (req, res, next) => {
  try {
    const [rows, price] = await Promise.all([listDeliveriesJoined({}), getCurrentPrice()]);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Tsion ERP Firebase';
    const sheet = workbook.addWorksheet('Deliveries');
    sheet.columns = [
      { header: 'FS Number', key: 'fs_number' },
      { header: 'Supermarket', key: 'supermarket_name' },
      { header: 'Branch', key: 'supermarket_branch' },
      { header: 'Qty Delivered', key: 'qty_delivered', style: { numFmt: '#,##0' } },
      { header: 'Qty Sold', key: 'qty_sold', style: { numFmt: '#,##0' } },
      { header: 'Qty Returned', key: 'qty_returned', style: { numFmt: '#,##0' } },
      { header: 'Balance (KG)', key: 'qty_balance', style: { numFmt: '#,##0' } },
      { header: 'Revenue (ETB)', key: 'revenue', style: { numFmt: '#,##0.00' } },
      { header: 'Price/KG', key: 'price_per_kg', style: { numFmt: '#,##0.00' } },
      { header: 'Delivery Date', key: 'delivery_date' },
      { header: 'Status', key: 'status' },
      { header: 'Driver', key: 'driver' }
    ];
    sheet.getRow(1).eachCell(applyHeaderStyle);
    rows.forEach((row, index) => {
      const added = sheet.addRow({ ...row, revenue: toNumber(row.qty_sold) * toNumber(price.price_per_kg), price_per_kg: price.price_per_kg });
      added.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 === 0 ? 'FFFFFFFF' : 'FFFFF8F8' } };
    });
    sheet.addRow({});
    const totalRow = sheet.addRow({
      fs_number: 'TOTALS',
      qty_delivered: { formula: `SUM(D2:D${rows.length + 1})` },
      qty_sold: { formula: `SUM(E2:E${rows.length + 1})` },
      qty_returned: { formula: `SUM(F2:F${rows.length + 1})` },
      qty_balance: { formula: `SUM(G2:G${rows.length + 1})` },
      revenue: { formula: `SUM(H2:H${rows.length + 1})` }
    });
    totalRow.font = { bold: true };
    totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8F8' } };
    autoWidth(sheet);
    await sendWorkbook(res, workbook, `tsion-deliveries-${Date.now()}.xlsx`);
  } catch (error) {
    next(error);
  }
});

app.get('/api/export/receivables', async (req, res, next) => {
  try {
    const supermarkets = (await getAll('supermarkets')).filter(item => item.status === 'Active');
    const payments = await getAll('payments');
    const deliveries = await getAll('deliveries');
    const rows = supermarkets
      .map(sm => ({
        code: sm.code,
        name: sm.name,
        branch: sm.branch,
        credit_limit: toNumber(sm.credit_limit),
        outstanding: toNumber(sm.outstanding),
        credit_pct: toNumber(sm.credit_limit) ? Math.round((toNumber(sm.outstanding) / toNumber(sm.credit_limit)) * 1000) / 10 : 0,
        credit_status: toNumber(sm.outstanding) > toNumber(sm.credit_limit)
          ? 'Over Limit'
          : toNumber(sm.outstanding) > toNumber(sm.credit_limit) * 0.8
            ? 'Near Limit'
            : 'Good',
        last_payment: sortByNewest(payments.filter(payment => payment.supermarket_id === sm.id), 'payment_date')[0]?.payment_date || null,
        last_delivery: sortByNewest(deliveries.filter(delivery => delivery.supermarket_id === sm.id), 'delivery_date')[0]?.delivery_date || null
      }))
      .sort((left, right) => right.outstanding - left.outstanding);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Tsion ERP Firebase';
    const sheet = workbook.addWorksheet('Receivables');
    sheet.columns = [
      { header: 'Code', key: 'code' },
      { header: 'Supermarket', key: 'name' },
      { header: 'Branch', key: 'branch' },
      { header: 'Credit Limit', key: 'credit_limit', style: { numFmt: '#,##0.00' } },
      { header: 'Outstanding', key: 'outstanding', style: { numFmt: '#,##0.00' } },
      { header: 'Credit Used (%)', key: 'credit_pct', style: { numFmt: '0.0"%"' } },
      { header: 'Credit Status', key: 'credit_status' },
      { header: 'Last Payment', key: 'last_payment' },
      { header: 'Last Delivery', key: 'last_delivery' }
    ];
    sheet.getRow(1).eachCell(applyHeaderStyle);
    rows.forEach((row, index) => {
      const added = sheet.addRow(row);
      added.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 === 0 ? 'FFFFFFFF' : 'FFFFF8F8' } };
    });
    autoWidth(sheet);
    await sendWorkbook(res, workbook, `tsion-receivables-${Date.now()}.xlsx`);
  } catch (error) {
    next(error);
  }
});

app.get('/api/export/csv/:table', async (req, res, next) => {
  try {
    const allowed = ['supermarkets', 'deliveries', 'payments', 'inventory_transactions'];
    const table = req.params.table;
    if (!allowed.includes(table)) return res.status(400).json({ error: 'Invalid table' });
    const rows = await getAll(table);
    if (!rows.length) return res.json({ message: 'No data' });
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(','),
      ...rows.map(row => headers.map(header => {
        const value = row[header] === null || row[header] === undefined ? '' : String(row[header]);
        return value.includes(',') || value.includes('"') || value.includes('\n')
          ? `"${value.replace(/"/g, '""')}"`
          : value;
      }).join(','))
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=tsion-${table}-${Date.now()}.csv`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  void next;
  console.error(error);
  res.status(500).json({ error: error.message || 'Internal server error' });
});

exports.api = onRequest({ timeoutSeconds: 540, memory: '1GiB', cors: true }, app);
