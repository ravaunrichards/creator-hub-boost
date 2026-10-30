# Guest service orders and fulfilment

## Guest purchase flow
1. A visitor chooses one of the Creator Hub Boost review services and a server-priced package.
2. The visitor supplies a public TikTok profile/video URL and a checkout email. No Creator Hub Boost account is required.
3. The API creates a PayPal order using the package price stored on the server.
4. After PayPal returns, the API captures the payment and verifies the exact amount, currency, PayPal order ID, capture ID, and private tracking token.
5. A confirmed order enters the operations queue as `under_review`. A private tracking link is returned to the browser and emailed when Resend is configured.
6. A staff member completes the deliverable in the admin console. The customer can reopen the private link to read status and fulfilment notes.

## Required server environment
- `DATABASE_URL`: PostgreSQL connection string.
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV`: PayPal REST app credentials and sandbox/live selection.
- `PUBLIC_APP_URL`: the deployed HTTPS origin, for example `https://creator-hub-boost.onrender.com`.
- `RESEND_API_KEY`, `EMAIL_FROM`: Resend transactional mail API key and a verified sender address. Without them, the application will still show the secure tracking link after checkout, but it cannot send the email.

## Database
Apply `db/migrations/003_guest_service_orders.sql` to an existing deployment after the orders table has been created. A fresh install should apply the complete schema and then all incremental migrations in order.

## Admin workflow
Sign in at `/admin.html`. Paid guest orders appear in the Guest service orders queue. Set a paid order to `in_progress` while it is being worked on; set it to `completed` and add the actual report/deliverable notes only when the work is complete. The tracking page displays these notes.

## Limitations
This product sells creator audits, creative reviews, and practical planning deliverables. It does not sell or automate followers, likes, views, shares, or fake engagement. The current manual fulfilment queue requires a real staff member to complete each paid review. Email delivery remains unconfigured until valid Resend credentials and a verified sender are set on the hosting service.
