-- Verified PayPal webhook inbox; event IDs prevent repeat crediting.
-- Apply after 001_rewards_wallet.sql.
CREATE TABLE IF NOT EXISTS paypal_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  resource_id TEXT,
  processing_status TEXT NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received','processed','ignored')),
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS paypal_webhook_events_status_received_idx
  ON paypal_webhook_events (processing_status, received_at DESC);
CREATE INDEX IF NOT EXISTS paypal_webhook_events_type_received_idx
  ON paypal_webhook_events (event_type, received_at DESC);
