require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');
const path      = require('path');
const fs        = require('fs');

const app = express();

// ── Middleware ───────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));
app.use(express.json());
app.use(morgan('dev'));

// Serve generated PDFs statically
app.use('/pdfs', express.static(path.join(__dirname, 'generated_pdfs')));
if (!fs.existsSync(path.join(__dirname, 'generated_pdfs'))) {
  fs.mkdirSync(path.join(__dirname, 'generated_pdfs'), { recursive: true });
}
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
  fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });
}

// ── Routes ───────────────────────────────────
app.use('/api/supermarkets', require('./routes/supermarkets'));
app.use('/api/inventory',    require('./routes/inventory'));
app.use('/api/deliveries',   require('./routes/deliveries'));
app.use('/api/payments',     require('./routes/payments'));
app.use('/api/reports',      require('./routes/reports'));
app.use('/api/pdf',          require('./routes/pdf'));
app.use('/api/export',       require('./routes/export'));
app.use('/api/meta',         require('./routes/meta'));
app.use('/api/uploads',      require('./routes/uploads'));

// ── Health check ─────────────────────────────
app.get('/', (req, res) => {
  const appHtml = path.join(__dirname, '..', 'tsion_erp_v2_full.html');
  if (fs.existsSync(appHtml)) {
    return res.sendFile(appHtml);
  }
  res.json({
    message: 'Tsion ERP API is running',
    health: '/api/health'
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), service: 'Tsion ERP API' });
});

// ── Error handler ────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🌾 Tsion ERP API running on http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health\n`);
});
