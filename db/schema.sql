-- Fresh-install schema for Creator Hub Boost. Existing installs can apply db/migrations/001_rewards_wallet.sql.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Legacy campaign orders are retained for backwards compatibility.
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  service_id TEXT NOT NULL,
  service_name TEXT NOT NULL,
  package_id TEXT NOT NULL,
  package_label TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  target_url TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('awaiting_payment','paid','under_review','in_progress','completed','cancelled','refunded')),
  paypal_order_id TEXT UNIQUE,
  paypal_capture_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 40),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uidx ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS wallets (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('credit','debit')),
  amount BIGINT NOT NULL CHECK (amount > 0),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('task_reward','coin_purchase','campaign_spend','campaign_refund','admin_adjustment')),
  reference_id UUID,
  idempotency_key TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wallet_transactions_user_created_idx ON wallet_transactions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  instructions TEXT NOT NULL,
  reward_coins INTEGER NOT NULL CHECK (reward_coins > 0),
  task_type TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_url TEXT NOT NULL,
  response_text TEXT NOT NULL CHECK (char_length(response_text) BETWEEN 20 AND 3000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reward_coins INTEGER NOT NULL CHECK (reward_coins > 0),
  review_note TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  UNIQUE (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS task_submissions_status_created_idx ON task_submissions (status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS task_submissions_user_created_idx ON task_submissions (user_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS coin_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_id TEXT NOT NULL,
  coins BIGINT NOT NULL CHECK (coins > 0),
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN ('awaiting_payment','paid','failed','refunded')),
  paypal_order_id TEXT UNIQUE,
  paypal_capture_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS coin_purchases_user_created_idx ON coin_purchases (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS campaign_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  package_id TEXT NOT NULL,
  package_label TEXT NOT NULL,
  target_url TEXT NOT NULL,
  coins_cost BIGINT NOT NULL CHECK (coins_cost > 0),
  response_count SMALLINT NOT NULL DEFAULT 1 CHECK (response_count > 0),
  reward_coins_per_response INTEGER NOT NULL DEFAULT 0 CHECK (reward_coins_per_response >= 0),
  status TEXT NOT NULL DEFAULT 'queued_for_review' CHECK (status IN ('queued_for_review','in_progress','completed','cancelled','refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS campaign_orders_user_created_idx ON campaign_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS campaign_orders_status_created_idx ON campaign_orders (status, created_at DESC);
CREATE TABLE IF NOT EXISTS campaign_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_order_id UUID NOT NULL REFERENCES campaign_orders(id) ON DELETE CASCADE,
  participant_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  response_text TEXT NOT NULL CHECK (char_length(response_text) BETWEEN 20 AND 3000),
  reward_coins INTEGER NOT NULL CHECK (reward_coins > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  review_note TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  UNIQUE (campaign_order_id, participant_user_id)
);
CREATE INDEX IF NOT EXISTS campaign_responses_status_created_idx ON campaign_responses (status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS campaign_responses_participant_idx ON campaign_responses (participant_user_id, submitted_at DESC);

INSERT INTO tasks (id, title, description, instructions, reward_coins, task_type) VALUES
('video-feedback','Public video feedback','Help a creator improve their public video with useful, specific feedback.','Review the public video, then write constructive notes about its opening, clarity, pacing, or accessibility. Do not follow, like, comment for metric manipulation, or promise engagement.',25,'content_feedback'),
('profile-feedback','Creator profile review','Give a creator practical ideas to make their public profile easier to understand.','Review the creator bio, profile presentation, and content themes. Suggest one or two improvements. Do not exchange follows or ask for artificial engagement.',30,'profile_feedback'),
('caption-feedback','Caption idea review','Suggest a clear, original caption angle for a public creator video.','Review the linked content and write an original caption suggestion that accurately describes it. Do not submit spam or misleading claims.',20,'creative_feedback'),
('accessibility-review','Accessibility check','Help a creator make public content easier for more people to follow.','Review the linked video and identify a practical accessibility improvement, such as clearer on-screen text, captions, or contrast. Do not download or re-upload someone else’s content.',35,'accessibility_feedback')
ON CONFLICT (id) DO UPDATE SET
  title=EXCLUDED.title, description=EXCLUDED.description, instructions=EXCLUDED.instructions,
  reward_coins=EXCLUDED.reward_coins, task_type=EXCLUDED.task_type, is_active=TRUE;

-- Verified PayPal event inbox. Event IDs are unique so retries cannot double-credit wallets.
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
