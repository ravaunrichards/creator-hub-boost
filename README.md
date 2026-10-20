# Creator Hub Boost

An original, responsive creator campaign storefront inspired by the *workflow* of TikSpark (service catalogue, package choice, order submission, PayPal checkout and order tracking). It does not use TikSpark's name, logo, text or source code. This is a **starter release**, not a claim that a live campaign fulfilment provider is connected.

## What's included

- Responsive storefront for Android/mobile and desktop.
- Filterable service catalogue and server-authoritative package prices.
- Order submission with TikTok URL validation, email validation and consent checkbox.
- PostgreSQL order persistence and private, time-limited tracking tokens.
- PayPal REST API sandbox/live mode selection, order creation and server-side capture validation.
- Administrator login and protected order listing/status update endpoints.
- Helmet security headers, rate limiting, input schemas, environment-based secrets, and automated domain tests.

## Requirements

- Node.js 20 or newer
- PostgreSQL 14 or newer
- PayPal REST app credentials (sandbox for testing)

## Local setup

1. Copy `.env.example` to `.env` and fill in values. Set a strong random `JWT_SECRET`; never commit `.env`.
2. Create a PostgreSQL database, then apply the schema:
   `psql "$DATABASE_URL" -f db/schema.sql`
3. Install dependencies: `npm install`
4. Start the app: `npm start`
5. Open `http://localhost:3000`.
6. Use PayPal sandbox credentials and sandbox buyer account first. Set `PAYPAL_ENV=live` only after your merchant account, policies and checkout are ready.

To configure the administrator, generate a bcrypt hash using:
`node -e "import('bcryptjs').then(async b=>console.log(await b.hash(process.argv[1], 12)))" 'replace-this-password'`
Put that hash in `ADMIN_PASSWORD_HASH` and the matching email in `ADMIN_EMAIL`. Never use a sample password in production.

## Test and checks

- `npm test` runs built-in Node tests for package integrity, server-side price selection, input validation and PayPal environment selection.
- `npm run check` checks JavaScript syntax.
- The test suite does not test a real database, PayPal merchant account, email delivery or campaign fulfilment. Those require environment credentials and integration testing.

## Important implementation notes

- **Fulfilment is not connected.** An order that is paid is queued for review. Connect only a lawful, transparent provider or fulfilment workflow that complies with TikTok's terms. This starter deliberately does not promise specific engagement results or implement fake/bot engagement.
- **Email delivery is not connected.** The tracking token is returned to the browser and stored in session storage for this initial release. Add a transactional email provider before public launch so users receive their private tracking link reliably.
- **Admin UI is API-only in this starter.** `/api/admin/login`, `/api/admin/orders` and `/api/admin/orders/:id/status` are provided; a full admin dashboard remains a follow-on task.
- Configure HTTPS, database backups, monitoring, privacy/terms/refund pages, age/jurisdiction requirements, webhook verification, and production secrets before launch.
- Use a production-grade secret manager and do not run with the fallback development JWT secret.

## API outline

- `GET /api/health`
- `GET /api/services`
- `POST /api/orders`
- `POST /api/paypal/create-order`
- `POST /api/paypal/capture-order`
- `GET /api/orders/:id/status?token=...`
- `POST /api/admin/login`
- `GET /api/admin/orders` (Bearer admin JWT)
- `PATCH /api/admin/orders/:id/status` (Bearer admin JWT)

## Source reference

Design and feature planning reference supplied by the user: https://tikspark.xyz/en. Creator Hub Boost is an independent brand and implementation.
