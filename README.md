# Creator Hub Boost

Creator Hub Boost is an independent creator rewards and promotion platform. Its core loop is:

1. Members complete creator-support tasks and submit useful feedback for review.
2. An administrator approves eligible work; the server credits the member's virtual coin wallet.
3. Members can buy additional fixed coin packages through PayPal.
4. Members spend virtual coins on Creator Hub Boost campaign requests.
5. Members can view wallet transactions and campaign-order statuses.

This implementation is an early functional release. It does not claim to be TikSpark, use TikSpark source code or branding, or connect an external campaign-fulfilment provider.

## Current feature set

- **Account access:** email/password registration and sign-in, bcrypt password hashes, signed user tokens, and server-side account lookups.
- **Task rewards:** task catalogue, public TikTok URL validation, feedback submissions, one submission per task at a time, manual review, rejection notes, and rewards credited only after approval.
- **Virtual wallet:** integer coin balances, an auditable credit/debit ledger, idempotency keys, and transaction history.
- **PayPal top-ups:** fixed server-priced coin packages, REST checkout-order creation, authenticated capture requests, exact currency/amount/reference validation, and transactional one-time coin credit.
- **Campaign marketplace:** discovery spotlight, human-audience feedback, and creative review packages; campaign orders debit the wallet inside a database transaction.
- **Admin console:** open /admin.html; administrators can review task submissions and move campaign orders through the manual workflow. Cancelling a campaign refunds its coin cost to the member wallet.
- **Baseline protections:** Helmet headers, API rate limiting, Zod request validation, environment-based secrets, HTTPS-only TikTok link validation, parameterized database queries, and automated domain tests.
- **Responsive web interface:** task cards, wallet summary, PayPal coin packages, campaign marketplace, and order history for desktop and mobile.

## Requirements

- Node.js 20 or newer
- PostgreSQL 14 or newer
- PayPal Developer REST app credentials for coin checkout (start with sandbox credentials)

## Local installation

1. Copy the sample environment file:

       cp .env.example .env

2. Edit .env. Set a unique JWT_SECRET, DATABASE_URL, and PUBLIC_APP_URL. Keep PAYPAL_ENV=sandbox until testing is complete.
3. Create a PostgreSQL database, then apply the fresh-install schema:

       psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql

   The schema creates the tables and seeds the starter task catalogue.

4. Install dependencies and start the application:

       npm install
       npm run check
       npm test
       npm start

5. Open http://localhost:3000.

### Updating an existing database

If the previous Creator Hub Boost schema is already installed, apply the incremental migration rather than recreating tables:

    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/001_rewards_wallet.sql

The migration is idempotent and seeds or updates the initial task catalogue.

### Docker Compose

After creating .env, run:

    docker compose up --build

The Compose file starts PostgreSQL and the application, waits for the database health check, and applies db/schema.sql on the first database-volume initialization. If the database volume already exists, apply the migration manually. Change POSTGRES_PASSWORD from the local default before using Compose anywhere beyond local development.

## Configure administrator access

Generate a bcrypt password hash:

    node -e "import('bcryptjs').then(async b => console.log(await b.hash(process.argv[1], 12)))" 'use-a-new-strong-password'

Set the resulting hash in ADMIN_PASSWORD_HASH and the matching email in ADMIN_EMAIL inside the server environment. Do not commit real secrets or use a sample password. Sign in through /admin.html.

## Configure PayPal coin purchases

1. Create or select a PayPal Developer REST app and obtain its client ID and secret.
2. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in the server environment.
3. Set PAYPAL_ENV=sandbox and use sandbox buyer credentials for testing.
4. Set PUBLIC_APP_URL to the exact external application origin used for the checkout return URL.
5. Verify that a successful sandbox purchase credits the expected coin package exactly once before enabling live mode.

The coin packages and prices are defined in server/domain.js; price and coin quantities are never accepted from the browser. PayPal capture confirms the exact purchase reference, currency, and amount before a database transaction marks the purchase paid and credits the wallet.

## Important product and deployment limitations

- **Coin balances are virtual credits.** They are not cash, are not withdrawable, and have no cash value in this implementation.
- **Task rewards require review.** The starter tasks request original feedback about public content or profiles; users cannot credit their own wallets by changing browser data.
- **External campaign fulfilment is not connected.** Paid-in-coins campaign requests are recorded as queued_for_review; the admin workflow is manual. The UI does not claim that external engagement has been delivered.
- **No email verification or password-reset delivery is configured.** Add a transactional email provider and account-recovery workflow before public launch.
- **PayPal webhooks and payment-refund processing are not configured.** The starter confirms coin purchases when the member returns from checkout. Configure verified webhooks, dispute handling, and a monitored reconciliation workflow before production use.
- **No automated follower/like exchange is implemented.** Do not add paid follow-for-follow, fake likes, bots, or artificial engagement guarantees. Review TikTok's current terms and platform policies before connecting any external fulfilment service.
- Before real users or payments, complete database backups, HTTPS, production secret management, security review, accessibility/device testing, privacy/terms/refund pages, retention rules, support procedures, and applicable legal/age/jurisdiction review.

Production requires a real JWT_SECRET with at least 32 characters. The server refuses to start in production if the secret is missing, too short, or still uses the sample placeholder.

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
- POST /api/coins/create-order
- POST /api/coins/capture-order
- POST /api/campaign-orders
- GET /api/campaign-orders

### Admin (Bearer administrator token)
- POST /api/admin/login
- GET /api/admin/task-submissions?status=pending
- PATCH /api/admin/task-submissions/:id
- GET /api/admin/campaign-orders?status=all
- PATCH /api/admin/campaign-orders/:id

## Validation

- npm test runs the Node.js test suite for catalogue integrity, server-side package validation, task/campaign validation, TikTok URL validation, and PayPal environment selection.
- npm run check checks JavaScript syntax for the backend, domain module, user UI, and admin UI.
- GitHub Actions runs the tests and syntax checks on pushes and pull requests.
- These checks do not replace tests against a live PostgreSQL instance, real PayPal sandbox credentials, browser/device end-to-end testing, or a professional security review.
