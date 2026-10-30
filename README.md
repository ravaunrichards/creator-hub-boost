# Creator Hub Boost

Creator Hub Boost is a creator rewards and audience-feedback platform. Members earn virtual coins by completing reviewable tasks, can purchase additional coin packages through PayPal, and spend coins to request useful feedback from real people about their public creator content.

**Genuine means human, voluntary interest—not bots, fake accounts, or paid promises of TikTok follows/likes.** The platform can give creators real human discovery and feedback, but it must not require or reward a specific TikTok follow, like, share, or comment. TikTok identifies engagement-exchange incentives and services that artificially inflate metrics as prohibited fake engagement. See [TikTok's explanation of how it counters deceptive behaviour](https://newsroom.tiktok.com/how-tiktok-counters-deceptive-behaviour?lang=en-150) and its [Creator Fraud, Abuse, and Misconduct Policy](https://seller-us.tiktok.com/university/essay?default_language=en&knowledge_id=5453247374362369).

## How the platform works

1. A member registers and receives a virtual-coin wallet.
2. Members complete eligible standalone tasks and submit their original work. An administrator reviews it and approves or rejects it.
3. A member may buy fixed coin packages using PayPal. The server verifies the purchase reference, amount and currency before crediting coins.
4. A creator chooses a feedback campaign and pays its coin cost from their wallet. The campaign is listed in the Available Feedback task board for other members; the creator cannot complete their own campaign.
5. A participant opens the creator's public TikTok content, then submits independent feedback about the content, clarity, pacing, accessibility or creative presentation.
6. An administrator reviews each response. Approved responses credit the participant's wallet, and the creator can read the approved feedback on their campaign order.
7. Campaigns complete automatically after the requested number of responses has been approved. Eligible cancellations before any approved responses refund the creator's coin cost.

## Current feature set

- **Accounts:** email/password registration, sign-in, bcrypt password hashes, signed access tokens, and account-scoped data.
- **Wallet:** integer virtual-coin balance, transaction history, server-side credits/debits, and unique transaction idempotency keys.
- **Earn tasks:** public-content feedback tasks; server-validated submissions; administrative review; approved coin rewards only.
- **Human feedback campaigns:** real members can submit original feedback on a creator's public TikTok content; campaign quantities are tracked; one response per participant per campaign; creators cannot respond to their own campaign.
- **Rewards from campaigns:** per-response rewards are set by the server, not the browser. Responses are reviewed; coins are credited only after approval. A campaign completes when its requested response count is approved.
- **Coin shop:** fixed packages at server-defined prices, PayPal REST checkout-order creation, authenticated capture verification, exact purchase-reference/currency/amount validation, and transactional wallet credit.
- **Campaign management:** coin-paid campaign orders, remaining response counts, approved-response history for creators, admin review queue, completion after approval target, and cancellation/refund guardrails.
- **Admin console:** open /admin.html to review standalone tasks, genuine campaign feedback, and order statuses.
- **Baseline protections:** Helmet, API rate limiting, Zod request validation, environment-based secrets, HTTPS TikTok URL checks, parameterized SQL queries, and automated tests.
- **Responsive interface:** mobile/desktop account dashboard, wallet, task cards, coin packages, campaign marketplace, approved feedback and order history.

The product does **not** use bots, fabricated accounts, fake comments, or any automation to create TikTok metrics. Participants are free to follow or interact with content if they independently want to; no specific off-platform engagement is required to earn task rewards.

## Requirements

- Node.js 20 or newer
- PostgreSQL 14 or newer
- PayPal Developer REST app credentials for coin purchases (start with sandbox credentials)

## Local setup

1. Copy the environment template:

       cp .env.example .env

2. Edit .env. Set a unique JWT_SECRET, DATABASE_URL, and PUBLIC_APP_URL. Keep PAYPAL_ENV=sandbox while testing.
3. For a fresh database, apply the full schema:

       psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql

4. For an existing installation, apply the incremental migration:

       psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/001_rewards_wallet.sql

   The migration creates/updates wallet, task, coin-purchase, campaign-order, and campaign-response tables. Existing databases need the migration before using the new feedback workflow.

5. Install, test and start:

       npm install
       npm run check
       npm test
       npm start

6. Open http://localhost:3000.

## Docker Compose

Create .env first, then run:

    docker compose up --build

Compose starts PostgreSQL and the app, waits for the database health check, and applies db/schema.sql on the first database-volume initialization. Existing volumes need the incremental migration. Replace the local default POSTGRES_PASSWORD before using Compose outside local development.

## Configure administrator access

Generate a bcrypt password hash:

    node -e "import('bcryptjs').then(async b => console.log(await b.hash(process.argv[1], 12)))" 'use-a-new-strong-password'

Set the resulting hash in ADMIN_PASSWORD_HASH and the matching email in ADMIN_EMAIL. Do not commit real credentials or use sample passwords. Sign in through /admin.html.

## Configure PayPal coin purchases

1. Create or select a PayPal Developer REST app and obtain its client ID and secret.
2. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in the server environment.
3. Use PAYPAL_ENV=sandbox and sandbox buyer credentials first.
4. Set PUBLIC_APP_URL to the actual external application origin used by the checkout return URL.
5. Verify successful sandbox purchases credit the correct package once before enabling live mode.

Coin packages and prices are defined in server/domain.js; the browser cannot set a price or coin quantity. A coin purchase is credited only after PayPal reports a completed capture that matches the saved purchase reference, amount and currency.

## PayPal webhook configuration

The server now supports `POST /api/paypal/webhook`. It verifies the PayPal transmission signature through PayPal's verification API before processing any event.

1. Set `PAYPAL_WEBHOOK_ID` to the exact ID from the PayPal Developer Dashboard.
2. Register `https://YOUR_PUBLIC_APP_HOST/api/paypal/webhook` as the webhook URL on the same PayPal REST app used by the server.
3. Subscribe to `PAYMENT.CAPTURE.COMPLETED`.
4. Apply `db/migrations/002_paypal_webhooks.sql` to an existing database. A fresh installation gets the table from `db/schema.sql`.
5. Test with PayPal sandbox credentials and a real sandbox webhook delivery before switching any environment to live.

Only a verified completed capture whose PayPal order ID, amount, and currency match a saved pending purchase can credit coins. The purchase lock, unique capture ID, and unique wallet-ledger idempotency key protect against duplicate delivery and races with the browser capture-return route. Unsupported events, unknown orders, and mismatches are recorded without wallet credit. This code still requires a real webhook ID, HTTPS deployment, and sandbox end-to-end verification before production.

## Important limitations before public launch

- **Virtual coins are not cash.** They cannot be withdrawn and are not cash-equivalent in this implementation.
- **Task rewards need human review.** This starter includes an administrator review queue but does not yet automate quality scoring or abuse detection.
- **Genuine feedback is not a promised TikTok metric.** A campaign provides a route to real human review and independent discovery; it does not guarantee follows, likes, comments, views, or recommendation placement. A human click can still be artificially incentivized if the reward depends on a follow/like, so reward conditions must remain about the feedback or platform's own promotion activity, not the TikTok metric.
- **Campaign responses are manually reviewed.** The app supplies the task board and response flow, but the admin must review responses. It does not automatically prove a participant watched a video for a specific duration.
- **Email verification and password reset are not configured.** Add a transactional email provider and safe recovery flow before public launch.
- **PayPal webhooks, disputes and payment refunds are not configured.** The starter capture flow verifies payments when the user returns from PayPal. Configure verified webhooks and reconciliation before production.
- Before public users or live payments, complete PostgreSQL integration tests, HTTPS, production secret management, database backups, accessibility/device testing, privacy/terms/refund pages, data-retention rules, support procedures, relevant legal/age/jurisdiction review, and a security audit.

Production requires a real JWT_SECRET with at least 32 characters. The application refuses to start in production if the secret is missing, too short, or still the sample placeholder.

## API outline

### Public
- GET /api/health
- GET /api/catalogue
- GET /api/coin-packages
- GET /api/campaigns

### Account and wallet (Bearer user token)
- POST /api/auth/register
- POST /api/auth/login
- GET /api/me
- GET /api/wallet/transactions

### Tasks and campaigns (Bearer user token)
- GET /api/tasks
- POST /api/tasks/:taskId/submissions
- GET /api/available-feedback
- POST /api/campaign-orders
- GET /api/campaign-orders
- POST /api/campaign-orders/:id/responses
- POST /api/coins/create-order
- POST /api/coins/capture-order
- POST /api/paypal/webhook (PayPal signature-verified event receiver)

### Admin (Bearer administrator token)
- POST /api/admin/login
- GET /api/admin/task-submissions?status=pending
- PATCH /api/admin/task-submissions/:id
- GET /api/admin/campaign-responses?status=pending
- PATCH /api/admin/campaign-responses/:id
- GET /api/admin/campaign-orders?status=all
- PATCH /api/admin/campaign-orders/:id

## Validation

- npm test checks catalogue integrity, coin and response reward terms, task/campaign validation, TikTok URL validation, and PayPal environment selection.
- npm run check syntax-checks the backend, domain logic, member UI and admin UI.
- GitHub Actions runs tests and syntax checks on pushes and pull requests.
- A green unit/syntax run is not a substitute for live database integration tests, PayPal sandbox testing, browser/device testing, or a professional security review.
