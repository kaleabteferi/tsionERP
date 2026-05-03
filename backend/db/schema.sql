-- Tsion ERP — PostgreSQL Schema
-- Run: psql -U postgres -d tsion_erp -f schema.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────
-- SUPERMARKETS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supermarkets (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code          VARCHAR(20) UNIQUE NOT NULL,
  name          VARCHAR(150) NOT NULL,
  branch        VARCHAR(150),
  tin           VARCHAR(30),
  contact_name  VARCHAR(100),
  phone         VARCHAR(30),
  email         VARCHAR(120),
  address       TEXT,
  lat           DECIMAL(10,7),
  lng           DECIMAL(10,7),
  credit_limit  DECIMAL(14,2) DEFAULT 20000,
  outstanding   DECIMAL(14,2) DEFAULT 0,
  status        VARCHAR(20) DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
  payment_terms VARCHAR(50) DEFAULT 'Consignment',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- PRICING
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pricing (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  price_per_kg  DECIMAL(10,2) NOT NULL,
  effective_date DATE NOT NULL,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- INVENTORY (WAREHOUSE)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ref           VARCHAR(30) UNIQUE NOT NULL,
  type          VARCHAR(20) NOT NULL CHECK (type IN ('stock_in','stock_out','return','adjustment')),
  qty           DECIMAL(12,2) NOT NULL,
  note          TEXT,
  delivery_id   UUID,
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS warehouse_stock (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  current_qty   DECIMAL(12,2) DEFAULT 0,
  total_received DECIMAL(12,2) DEFAULT 0,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO warehouse_stock (current_qty, total_received) VALUES (0, 0)
  ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────
-- DELIVERIES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deliveries (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fs_number     VARCHAR(20) UNIQUE NOT NULL,
  supermarket_id UUID NOT NULL REFERENCES supermarkets(id),
  qty_delivered DECIMAL(12,2) NOT NULL,
  qty_sold      DECIMAL(12,2) DEFAULT 0,
  qty_returned  DECIMAL(12,2) DEFAULT 0,
  qty_balance   DECIMAL(12,2) GENERATED ALWAYS AS (qty_delivered - qty_sold - qty_returned) STORED,
  delivery_date DATE NOT NULL,
  driver        VARCHAR(100),
  status        VARCHAR(20) DEFAULT 'Delivered' CHECK (status IN ('Pending','Delivered','Partial')),
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- SALES REPORTS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales_reports (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  delivery_id   UUID NOT NULL REFERENCES deliveries(id),
  supermarket_id UUID NOT NULL REFERENCES supermarkets(id),
  qty_sold      DECIMAL(12,2) NOT NULL,
  price_per_kg  DECIMAL(10,2) NOT NULL,
  total_value   DECIMAL(14,2) GENERATED ALWAYS AS (qty_sold * price_per_kg) STORED,
  report_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- PAYMENTS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ref           VARCHAR(30) UNIQUE NOT NULL,
  supermarket_id UUID NOT NULL REFERENCES supermarkets(id),
  amount        DECIMAL(14,2) NOT NULL,
  payment_date  DATE NOT NULL,
  method        VARCHAR(50) DEFAULT 'Bank Transfer',
  reference_no  VARCHAR(100),
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- RETURNS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS returns (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ref           VARCHAR(30) UNIQUE NOT NULL,
  delivery_id   UUID NOT NULL REFERENCES deliveries(id),
  supermarket_id UUID NOT NULL REFERENCES supermarkets(id),
  qty           DECIMAL(12,2) NOT NULL,
  reason        VARCHAR(50) CHECK (reason IN ('Damaged','Packaging Issue','Unsold','Other')),
  resellable    BOOLEAN DEFAULT TRUE,
  return_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- PRICE CHANGE LETTERS (document log)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_letters (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ref           VARCHAR(30) UNIQUE NOT NULL,
  new_price     DECIMAL(10,2) NOT NULL,
  effective_date DATE NOT NULL,
  message_body  TEXT,
  sent_to       TEXT[],
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_deliveries_sm ON deliveries(supermarket_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_date ON deliveries(delivery_date);
CREATE INDEX IF NOT EXISTS idx_payments_sm ON payments(supermarket_id);
CREATE INDEX IF NOT EXISTS idx_sales_delivery ON sales_reports(delivery_id);
CREATE INDEX IF NOT EXISTS idx_returns_delivery ON returns(delivery_id);

-- ─────────────────────────────────────────────
-- TRIGGERS — auto-update updated_at
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_supermarkets_updated ON supermarkets;
CREATE TRIGGER trg_supermarkets_updated
  BEFORE UPDATE ON supermarkets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_deliveries_updated ON deliveries;
CREATE TRIGGER trg_deliveries_updated
  BEFORE UPDATE ON deliveries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
