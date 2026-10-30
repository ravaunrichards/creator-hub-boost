import express from 'express';

const router = express.Router();

function headerValue(req, name) {
  return String(req.get(name) || '').trim();
}

function cents(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const result = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  return Number.isSafeInteger(result) ? result : null;
}

/** Normalize only an event that is permitted to credit a wallet. */
export function extractCompletedCapture(event) {
  if (!event || event.event_type !== 'PAYMENT.CAPTURE.COMPLETED') return null;
  const resource = event.resource;
  const orderId = resource?.supplementary_data?.related_ids?.order_id;
  const captureId = resource?.id;
  const amount = resource?.amount?.value;
  const currency = resource?.amount?.currency_code;
  if (
    typeof orderId !== 'string' || !orderId.trim() ||
    typeof captureId !== 'string' || !captureId.trim() ||
    typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency) ||
    cents(amount) === null
  ) return null;
  return { orderId: orderId.trim(), captureId: captureId.trim(), amount: String(amount), currency };
}

export function matchesExpectedPayment(purchase, capture) {
  return Boolean(
    purchase && capture &&
    String(purchase.currency ?? '').trim().toUpperCase() === capture.currency &&
    cents(purchase.amount) !== null &&
    cents(purchase.amount) === cents(capture.amount)
  );
}

async function verifyPayPalSignature(req, getAccessToken, paypalBaseUrl) {
  const webhookId = String(process.env.PAYPAL_WEBHOOK_ID || '').trim();
  if (!webhookId) throw Object.assign(new Error('PayPal webhook is not configured. Set PAYPAL_WEBHOOK_ID.'), { statusCode: 503 });
  const transmission = {
    auth_algo: headerValue(req, 'paypal-auth-algo'),
    cert_url: headerValue(req, 'paypal-cert-url'),
    transmission_id: headerValue(req, 'paypal-transmission-id'),
    transmission_sig: headerValue(req, 'paypal-transmission-sig'),
    transmission_time: headerValue(req, 'paypal-transmission-time')
  };
  if (Object.values(transmission).some(value => !value) || !req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw Object.assign(new Error('PayPal webhook signature headers or event body are incomplete.'), { statusCode: 400 });
  }
  const accessToken = await getAccessToken();
  const response = await fetch(`${paypalBaseUrl()}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...transmission, webhook_id: webhookId, webhook_event: req.body })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error('PayPal could not verify the webhook signature.'), { statusCode: 502 });
  if (result.verification_status !== 'SUCCESS') {
    throw Object.assign(new Error('PayPal webhook signature verification failed.'), { statusCode: 401 });
  }
}

async function recordIgnored(client, event, resourceId, reason) {
  await client.query(
    `INSERT INTO paypal_webhook_events (event_id,event_type,resource_id,processing_status,error_message,processed_at)
     VALUES ($1,$2,$3,'ignored',$4,NOW())
     ON CONFLICT (event_id) DO UPDATE SET processing_status='ignored',error_message=EXCLUDED.error_message,processed_at=NOW()`,
    [event.id, event.event_type, resourceId || null, reason]
  );
}

/**
 * Apply a verified event and wallet mutation in one transaction. A purchase row
 * lock serializes webhook deliveries with the browser capture-return endpoint.
 */
async function processVerifiedEvent(pool, event) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const seen = await client.query(
      'SELECT processing_status FROM paypal_webhook_events WHERE event_id=$1 FOR UPDATE',
      [event.id]
    );
    if (seen.rows[0]?.processing_status === 'processed' || seen.rows[0]?.processing_status === 'ignored') {
      await client.query('COMMIT');
      return { duplicate: true, status: seen.rows[0].processing_status };
    }
    if (!seen.rows[0]) {
      await client.query(
        "INSERT INTO paypal_webhook_events (event_id,event_type,resource_id,processing_status) VALUES ($1,$2,$3,'received')",
        [event.id, event.event_type, event.resource?.id || null]
      );
    }

    if (event.event_type !== 'PAYMENT.CAPTURE.COMPLETED') {
      await recordIgnored(client, event, event.resource?.id, 'Event type is recorded but does not credit coins.');
      await client.query('COMMIT');
      return { duplicate: false, status: 'ignored' };
    }

    const capture = extractCompletedCapture(event);
    if (!capture) {
      await recordIgnored(client, event, event.resource?.id, 'Completed capture payload is incomplete or malformed.');
      await client.query('COMMIT');
      return { duplicate: false, status: 'ignored' };
    }

    const purchaseResult = await client.query(
      'SELECT id,user_id,coins,amount,currency,status,paypal_capture_id FROM coin_purchases WHERE paypal_order_id=$1 FOR UPDATE',
      [capture.orderId]
    );
    const purchase = purchaseResult.rows[0];
    if (!purchase) {
      // Guest service orders use PayPal too, but never credit a member coin wallet.
      const serviceOrderResult = await client.query(
        'SELECT id,amount,currency,status,paypal_capture_id FROM orders WHERE paypal_order_id=$1 FOR UPDATE',
        [capture.orderId]
      );
      const serviceOrder = serviceOrderResult.rows[0];
      if (!serviceOrder) {
        await recordIgnored(client, event, capture.captureId, 'No local coin purchase or guest service order matched the PayPal order ID.');
        await client.query('COMMIT');
        return { duplicate: false, status: 'ignored' };
      }
      if (['under_review','in_progress','completed'].includes(serviceOrder.status)) {
        if (serviceOrder.paypal_capture_id === capture.captureId) {
          await client.query(
            "UPDATE paypal_webhook_events SET processing_status='processed',error_message=NULL,processed_at=NOW() WHERE event_id=$1",
            [event.id]
          );
          await client.query('COMMIT');
          return { duplicate: false, status: 'service_order_already_confirmed' };
        }
        await recordIgnored(client, event, capture.captureId, 'Guest service order was already paid with a different capture ID.');
        await client.query('COMMIT');
        return { duplicate: false, status: 'ignored' };
      }
      const amountMatches = cents(serviceOrder.amount) === cents(capture.amount);
      const currencyMatches = String(serviceOrder.currency || '').trim().toUpperCase() === capture.currency;
      if (serviceOrder.status !== 'awaiting_payment' || !amountMatches || !currencyMatches) {
        await recordIgnored(client, event, capture.captureId, 'Guest service order was not awaiting payment or amount/currency did not match.');
        await client.query('COMMIT');
        return { duplicate: false, status: 'ignored' };
      }
      await client.query(
        "UPDATE orders SET status='under_review',paypal_capture_id=$2,paid_at=NOW() WHERE id=$1",
        [serviceOrder.id, capture.captureId]
      );
      await client.query(
        "UPDATE paypal_webhook_events SET processing_status='processed',error_message=NULL,processed_at=NOW() WHERE event_id=$1",
        [event.id]
      );
      await client.query('COMMIT');
      return { duplicate: false, status: 'service_order_confirmed' };
    }

    if (purchase.status === 'paid') {
      if (purchase.paypal_capture_id === capture.captureId) {
        await client.query(
          "UPDATE paypal_webhook_events SET processing_status='processed',error_message=NULL,processed_at=NOW() WHERE event_id=$1",
          [event.id]
        );
        await client.query('COMMIT');
        return { duplicate: false, status: 'already_credited' };
      }
      await recordIgnored(client, event, capture.captureId, 'Purchase was already paid with a different capture ID.');
      await client.query('COMMIT');
      return { duplicate: false, status: 'ignored' };
    }

    if (purchase.status !== 'awaiting_payment') {
      await recordIgnored(client, event, capture.captureId, 'Local purchase is not awaiting payment.');
      await client.query('COMMIT');
      return { duplicate: false, status: 'ignored' };
    }
    if (!matchesExpectedPayment(purchase, capture)) {
      await recordIgnored(client, event, capture.captureId, 'PayPal capture amount or currency did not match the saved purchase.');
      await client.query('COMMIT');
      return { duplicate: false, status: 'ignored' };
    }

    await client.query(
      "UPDATE coin_purchases SET status='paid',paypal_capture_id=$2,paid_at=NOW() WHERE id=$1",
      [purchase.id, capture.captureId]
    );
    const walletResult = await client.query(
      `INSERT INTO wallets (user_id,balance) VALUES ($1,$2)
       ON CONFLICT (user_id) DO UPDATE SET balance=wallets.balance+EXCLUDED.balance,updated_at=NOW()
       RETURNING balance`,
      [purchase.user_id, purchase.coins]
    );
    await client.query(
      `INSERT INTO wallet_transactions (user_id,direction,amount,transaction_type,reference_id,idempotency_key,description)
       VALUES ($1,'credit',$2,'coin_purchase',$3,$4,$5)`,
      [purchase.user_id, purchase.coins, purchase.id, `coin-purchase:${purchase.id}`, `PayPal coin package — ${purchase.coins} coins`]
    );
    await client.query(
      "UPDATE paypal_webhook_events SET processing_status='processed',error_message=NULL,processed_at=NOW() WHERE event_id=$1",
      [event.id]
    );
    await client.query('COMMIT');
    return { duplicate: false, status: 'credited', balance: Number(walletResult.rows[0].balance), coinsAdded: Number(purchase.coins) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function createPayPalWebhookRouter({ pool, getAccessToken, paypalBaseUrl }) {
  const webhookRouter = express.Router();
  webhookRouter.post('/webhook', async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'Database is not configured.' });
    if (!req.body || typeof req.body.id !== 'string' || !req.body.id.trim() || typeof req.body.event_type !== 'string' || !req.body.event_type.trim()) {
      return res.status(400).json({ error: 'PayPal event ID and event type are required.' });
    }
    try {
      await verifyPayPalSignature(req, getAccessToken, paypalBaseUrl);
      const result = await processVerifiedEvent(pool, req.body);
      return res.status(200).json({ received: true, ...result });
    } catch (error) {
      const status = Number(error.statusCode) || 500;
      if (status >= 500) console.error('PayPal webhook failed:', error.message);
      return res.status(status).json({ error: status >= 500 ? 'PayPal webhook could not be processed. PayPal may retry delivery.' : error.message });
    }
  });
  return webhookRouter;
}
