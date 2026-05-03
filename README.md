# 🌾 Tsion Parboiled Brown Rice — ERP System

Full-stack distribution ERP: Node.js backend + PostgreSQL + React frontend.

---

## Quick Start (Local Development)

### Prerequisites
- Node.js 18+
- PostgreSQL 14+ running locally
- Git

---

### 1. Clone & install

```bash
# Backend
cd tsion-erp/backend
cp .env.example .env
# Edit .env with your PostgreSQL password

npm install
```

### 2. Set up database

```bash
# Make sure PostgreSQL is running, then:
npm run db:setup   # Creates database + applies schema
npm run db:seed    # Adds sample data (supermarkets, deliveries, etc.)
```

### 3. Start backend

```bash
npm run dev
# API runs on http://localhost:3001
# Health check: http://localhost:3001/api/health
```

### 4. Frontend

```bash
cd tsion-erp/frontend
npm install
npm start
# App runs on http://localhost:3000
```

---

## API Endpoints

### Supermarkets
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/supermarkets` | List all (filter: `?status=Active&search=shoa`) |
| GET | `/api/supermarkets/:id` | Single supermarket + history |
| POST | `/api/supermarkets` | Create |
| PUT | `/api/supermarkets/:id` | Update |
| DELETE | `/api/supermarkets/:id` | Delete |

### Inventory
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/inventory/summary` | Warehouse stock summary |
| GET | `/api/inventory/transactions` | Transaction history |
| POST | `/api/inventory/stock-in` | Add stock received |
| GET | `/api/inventory/price` | Current price |
| POST | `/api/inventory/price` | Update price |

### Deliveries
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/deliveries` | List all |
| POST | `/api/deliveries` | Create (auto-deducts warehouse) |
| PATCH | `/api/deliveries/:id/sales` | Report sales (updates receivables) |

### Payments
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/payments` | List all |
| POST | `/api/payments` | Record payment (reduces outstanding) |

### PDF Generation
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/pdf/delivery-note/:id` | Download delivery note PDF |
| GET | `/api/pdf/sales-receipt/:id` | Download sales receipt PDF |
| POST | `/api/pdf/delivery-order` | Generate delivery order PDF |
| POST | `/api/pdf/price-change-letter` | Generate price letters for all SMs |

### Export
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/export/supermarkets` | Excel: supermarket list |
| GET | `/api/export/deliveries` | Excel: deliveries + revenue |
| GET | `/api/export/receivables` | Excel: aging report |
| GET | `/api/export/csv/:table` | CSV: any table |

---

## Google Maps Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project → Enable billing (free $200/month credit)
3. Enable these APIs:
   - Maps JavaScript API
   - Places API
   - Geocoding API
4. Credentials → Create credentials → API Key
5. Add to `.env`:
   ```
   GOOGLE_MAPS_API_KEY=your_key_here
   ```
6. Add to frontend `.env`:
   ```
   REACT_APP_MAPS_KEY=your_key_here
   ```

---

## Database Schema

```
supermarkets         → main supermarket profiles
inventory_transactions → all stock movements (in/out/return)
warehouse_stock      → single-row current stock state
deliveries           → consignment deliveries (FS# tracking)
sales_reports        → reported sales per delivery
payments             → payment records per supermarket
returns              → return tracking
price_letters        → price change letter log
pricing              → price history
```

---

## Phase 2 Roadmap

- [ ] Multi-user authentication (admin + driver roles)
- [ ] Batch/expiry tracking
- [ ] Email notifications (overdue, credit exceeded)
- [ ] WhatsApp/SMS alerts via Twilio
- [ ] Mobile PWA version
- [ ] Auto-sync with Google Maps for geocoding
- [ ] Dashboard charts with Recharts
- [ ] Docker deployment config

---

## Environment Variables

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=tsion_erp
DB_USER=postgres
DB_PASSWORD=your_password

PORT=3001
NODE_ENV=development

GOOGLE_MAPS_API_KEY=your_key
COMPANY_NAME=Tsion Parboiled Brown Rice
COMPANY_PHONE=+251 94 413 5444
COMPANY_ADDRESS=Addis Ababa, Ethiopia
COMPANY_TIN=your_tin
COMPANY_TAGLINE=100% Natural · Healthy · Gluten Free · Made in Ethiopia

FRONTEND_URL=http://localhost:3001

FILE_STORAGE_DRIVER=local
S3_ENDPOINT=
S3_REGION=
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=false
```

---

## Hosting

This project can be deployed as a single Node.js web service backed by PostgreSQL. The frontend is served by the same Express server, so you do not need a separate frontend host unless you want one later.

### Production Architecture

1. Host the Node app.
2. Host PostgreSQL separately.
3. Use `FILE_STORAGE_DRIVER=s3` in production if you want uploads and generated files to survive restarts.

Supported deployment files in this repo:

- `Dockerfile` for container deployments
- `docker-compose.yml` for VPS or local production-like hosting
- `render.yaml` for Render
- `railway.json` for Railway

### Option 1: Docker / VPS

1. Copy `backend/.env.example` to `backend/.env` and fill real values.
2. Start the stack:

```bash
docker compose up -d --build
```

3. Apply the schema once:

```bash
docker compose exec app node backend/db/setup.js
```

4. Open `http://your-server:3001`.

If you keep `FILE_STORAGE_DRIVER=local`, Docker volumes in `docker-compose.yml` will preserve uploads and generated PDFs.

### Option 2: Render

1. Push the repo to GitHub.
2. Create a new Blueprint deployment from this repo.
3. Render will read `render.yaml` and provision:
   - one Node web service
   - one PostgreSQL database
4. Set the remaining env vars in Render:
   - `FRONTEND_URL`
   - `COMPANY_NAME`
   - `COMPANY_PHONE`
   - `COMPANY_ADDRESS`
   - `COMPANY_TIN`
   - `COMPANY_TAGLINE`
   - `FILE_STORAGE_DRIVER=s3`
   - S3-compatible storage credentials
5. Run `node db/setup.js` once from the Render shell in the `backend` service.

### Option 3: Railway

1. Push the repo to GitHub.
2. Create a new Railway project from the repo.
3. Add a PostgreSQL service.
4. Railway will use `railway.json` to build and start the app.
5. Set these variables on the app service:
   - `DB_HOST`
   - `DB_PORT`
   - `DB_NAME`
   - `DB_USER`
   - `DB_PASSWORD`
   - `PORT=3001`
   - `NODE_ENV=production`
   - `FRONTEND_URL`
   - company info vars
   - `FILE_STORAGE_DRIVER=s3`
   - S3-compatible storage credentials
6. Run `node backend/db/setup.js` once.

### S3-Compatible File Storage

This app now supports both local disk and S3-compatible object storage for:

- uploaded attachments
- generated PDFs
- generated Excel exports

Use `FILE_STORAGE_DRIVER=s3` and set:

```env
S3_ENDPOINT=https://your-s3-endpoint
S3_REGION=auto
S3_BUCKET=tsion-erp-files
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=false
```

Providers that work well:

- AWS S3
- Cloudflare R2
- Backblaze B2 S3 API
- MinIO

### First Production Run Checklist

1. Set all production env vars.
2. Run `npm install` in `backend` if not using Docker.
3. Run `node db/setup.js` once.
4. Start the service with `npm start` or your platform start command.
5. Verify `GET /api/health` returns `status: ok`.
6. Add your first real data from the UI.

Host-specific ready-to-fill templates are included here:

- `backend/.env.render-r2.example`
- `backend/.env.railway-s3.example`
- `DEPLOYMENT.md`

### Security Notes

1. Do not commit real `.env` files.
2. Rotate any database password that may have been used in local examples.
3. Use HTTPS in production.
4. If frontend and backend are on different domains, set `FRONTEND_URL` correctly so CORS is limited to your real app origin.
