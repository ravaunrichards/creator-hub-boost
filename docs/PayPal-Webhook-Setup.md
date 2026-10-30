# PayPal webhook operations

## Endpoint
- Method: `POST`
- Path: `/api/paypal/webhook`
- Authentication: PayPal transmission-signature verification; not a member JWT.
- Event that can credit a wallet: `PAYMENT.CAPTURE.COMPLETED`.

## Configure PayPal
1. Use the same PayPal REST app whose client ID and secret are configured for the server.
2. Register the deployed HTTPS URL ending in `/api/paypal/webhook`.
3. Subscribe to `PAYMENT.CAPTURE.COMPLETED`.
4. Copy the provider's webhook ID into the server-side `PAYPAL_WEBHOOK_ID` environment variable. It is not the URL, app client ID, or client secret.
5. Apply `db/migrations/002_paypal_webhooks.sql` to an existing installation. Fresh databases should run `db/schema.sql`.
6. Send a sandbox test event and verify database state before enabling live checkout.

## Safety and idempotency
The endpoint asks PayPal to verify the transmission signature before database changes. It then checks the saved PayPal order, capture ID, amount, and currency. It credits only the exact pending local purchase. Wallet changes, purchase status, transaction ledger, and event state commit in one PostgreSQL transaction. Duplicate event IDs are acknowledged without a second credit, and the purchase row lock serializes events against the browser capture-return endpoint.

Unknown orders, unsupported events, malformed payloads, non-pending purchases, and mismatched amounts/currencies are recorded as ignored; they do not credit coins. Verification/configuration failures return HTTP errors. Actual PayPal delivery, sandbox behavior, and production credentials must still be tested against the real PayPal app.
