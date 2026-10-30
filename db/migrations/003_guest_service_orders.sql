-- Guest service checkout and secure order tracking.
-- Apply after the existing database schema/migrations.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_token_hash TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_token_expires_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfilment_notes TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS orders_email_created_idx ON orders (LOWER(email),created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_created_idx ON orders (status,created_at DESC);
