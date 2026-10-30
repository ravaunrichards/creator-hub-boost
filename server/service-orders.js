import express from 'express';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { validateTikTokUrl } from './domain.js';
import { SERVICE_CATALOGUE, findServicePackage } from './service-catalogue.js';

const router = express.Router();
const emailSchema = z.string().trim().email().max(254);
const orderInput = z.object({
  serviceId: z.string().max(80),
  packageId: z.string().max(100),
  targetUrl: z.string().trim().min(8).max(500),
  email: emailSchema
});
const captureInput = z.object({
  orderRef: z.string().uuid(),
  paypalOrderId: z.string().min(3).max(120),
  trackingToken: z.string().regex(/^[a-f0-9]{64}$/i)
});
const referenceInput = z.object({ reference: z.string().uuid(), email: emailSchema });
const adminUpdateInput = z.object({
  status: z.enum(['in_progress','completed','cancelled']),
  fulfilmentNotes: z.string().trim().max(5000).optional().default('')
});

const hashToken = value => createHash('sha256').update(String(value)).digest('hex');
function safeTokenMatch(supplied, stored) {
  if (typeof stored !== 'string' || !/^[a-f0-9]{64}$/i.test(stored)) return false;
  const left = Buffer.from(hashToken(supplied), 'hex');
  const right = Buffer.from(stored, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
function dollarsToCents(value) {
  const text = String(value ?? '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}
function safeOrder(row) {
  return {
    reference: row.id,
    service: row.service_name,
    package: row.package_label,
    amount: Number(row.amount),
    currency: String(row.currency).trim(),
    status: row.status,
    targetUrl: row.target_url,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    completedAt: row.completed_at,
    fulfilmentNotes: row.fulfilment_notes || ''
  };
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return false;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html, text })
  });
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    console.error('Transactional email provider rejected a message:', response.status, message.slice(0, 400));
    return false;
  }
  return true;
}
async function paypalToken(getAccessToken) {
  return getAccessToken();
}
function requireAdmin(req, res, next) {
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const claims = jwt.verify(token, process.env.JWT_SECRET || 'local-development-only-secret-change-before-deploy');
    if (claims.purpose !== 'admin-access' || claims.role !== 'admin') throw new Error('Invalid administrator token.');
    req.adminEmail = claims.email;
    next();
  } catch {
    res.status(401).json({ error: 'Administrator sign-in is required.' });
  }
}

export function createServiceOrdersRouter({ pool, getAccessToken, paypalBaseUrl, publicBaseUrl }) {
  const serviceRouter = express.Router();

  serviceRouter.get('/catalogue', (_req, res) => {
    res.json({ services: SERVICE_CATALOGUE, currency: 'USD', accountRequired: false });
  });

  serviceRouter.post('/create-order', async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'The order database is not configured.' });
    const parsed = orderInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose a service package, enter a public TikTok link and a valid checkout email.' });
    const selected = findServicePackage(parsed.data.serviceId, parsed.data.packageId);
    if (!selected) return res.status(400).json({ error: 'That service package is not available.' });
    let targetUrl;
    try { targetUrl = validateTikTokUrl(parsed.data.targetUrl); }
    catch (error) { return res.status(400).json({ error: error.message }); }

    const email = parsed.data.email.trim().toLowerCase();
    const orderRef = randomUUID();
    const trackingToken = randomBytes(32).toString('hex');
    const trackingTokenHash = hashToken(trackingToken);
    const { service, pack } = selected;
    try {
      await pool.query(
        `INSERT INTO orders
          (id,service_id,service_name,package_id,package_label,amount,currency,target_url,email,status,tracking_token_hash,tracking_token_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'awaiting_payment',$10,NOW()+INTERVAL '30 days')`,
        [orderRef, service.id, service.name, pack.id, pack.label, pack.price, pack.currency, targetUrl, email, trackingTokenHash]
      );
      const accessToken = await paypalToken(getAccessToken);
      const response = await fetch(`${paypalBaseUrl()}/v2/checkout/orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': orderRef },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{
            reference_id: orderRef,
            custom_id: orderRef,
            description: `${service.name} — ${pack.label}`,
            amount: { currency_code: pack.currency, value: Number(pack.price).toFixed(2) }
          }],
          application_context: {
            brand_name: 'Creator Hub Boost',
            user_action: 'PAY_NOW',
            return_url: `${publicBaseUrl()}/?service_payment=return&orderRef=${orderRef}`,
            cancel_url: `${publicBaseUrl()}/?service_payment=cancel&orderRef=${orderRef}`
          }
        })
      });
      const payload = await response.json().catch(() => ({}));
      const approveUrl = payload.links?.find(link => link.rel === 'approve')?.href;
      if (!response.ok || !payload.id || !approveUrl) {
        await pool.query("UPDATE orders SET status='cancelled' WHERE id=$1 AND status='awaiting_payment'", [orderRef]);
        return res.status(502).json({ error: 'PayPal could not start checkout. Confirm the merchant credentials and sandbox/live setting.' });
      }
      await pool.query('UPDATE orders SET paypal_order_id=$2 WHERE id=$1', [orderRef, payload.id]);
      res.status(201).json({
        orderRef, paypalOrderId: payload.id, trackingToken, approveUrl,
        amount: pack.price, currency: pack.currency, service: service.name, package: pack.label
      });
    } catch (error) {
      await pool.query("UPDATE orders SET status='cancelled' WHERE id=$1 AND status='awaiting_payment'", [orderRef]).catch(() => {});
      console.error('Guest service order creation failed:', error.message);
      res.status(502).json({ error: error.message || 'Could not start the order.' });
    }
  });

  serviceRouter.post('/capture-order', async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'The order database is not configured.' });
    const parsed = captureInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'The payment return is incomplete. Open your order tracking email or request a new tracking link.' });
    const { orderRef, paypalOrderId, trackingToken } = parsed.data;
    try {
      const lookup = await pool.query(
        'SELECT id,email,amount,currency,status,paypal_order_id,tracking_token_hash,tracking_token_expires_at FROM orders WHERE id=$1',
        [orderRef]
      );
      const order = lookup.rows[0];
      if (!order || order.paypal_order_id !== paypalOrderId || !safeTokenMatch(trackingToken, order.tracking_token_hash) || new Date(order.tracking_token_expires_at) < new Date()) {
        return res.status(404).json({ error: 'The order reference or private tracking token is not valid.' });
      }
      if (order.status === 'paid' || order.status === 'under_review' || order.status === 'in_progress' || order.status === 'completed') {
        return res.json({ status: order.status, trackingUrl: `${publicBaseUrl()}/orders.html?ref=${orderRef}&token=${trackingToken}`, emailSent: false, message: 'This order is already confirmed.' });
      }
      if (order.status !== 'awaiting_payment') return res.status(409).json({ error: 'This order is not awaiting payment.' });

      const accessToken = await paypalToken(getAccessToken);
      const response = await fetch(`${paypalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `service-capture-${orderRef}` }
      });
      const payload = await response.json().catch(() => ({}));
      const unit = payload.purchase_units?.find(item => item.custom_id === orderRef || item.reference_id === orderRef);
      const capture = unit?.payments?.captures?.[0];
      const exactAmount = dollarsToCents(capture?.amount?.value) === dollarsToCents(order.amount);
      const exactCurrency = capture?.amount?.currency_code === String(order.currency).trim();
      if (!response.ok || payload.status !== 'COMPLETED' || !unit || (unit.custom_id !== orderRef && unit.reference_id !== orderRef) || !capture?.id || !exactAmount || !exactCurrency) {
        return res.status(402).json({ error: 'PayPal has not confirmed the exact amount for this order. No service order was marked paid.' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const lockedResult = await client.query('SELECT id,email,status,paypal_order_id,tracking_token_hash,tracking_token_expires_at FROM orders WHERE id=$1 FOR UPDATE', [orderRef]);
        const locked = lockedResult.rows[0];
        if (!locked || locked.paypal_order_id !== paypalOrderId || !safeTokenMatch(trackingToken, locked.tracking_token_hash) || new Date(locked.tracking_token_expires_at) < new Date()) {
          throw new Error('Order token validation failed during payment confirmation.');
        }
        if (locked.status === 'awaiting_payment') {
          await client.query("UPDATE orders SET status='under_review',paypal_capture_id=$2,paid_at=NOW() WHERE id=$1", [orderRef, capture.id]);
        } else if (!['under_review','in_progress','completed'].includes(locked.status)) {
          throw new Error('The order is no longer awaiting payment.');
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }

      const trackingUrl = `${publicBaseUrl()}/orders.html?ref=${orderRef}&token=${trackingToken}`;
      const emailSent = await sendEmail({
        to: order.email,
        subject: 'Your Creator Hub Boost order is confirmed',
        text: `Your payment is confirmed. Track your order securely here: ${trackingUrl}`,
        html: `<p>Your payment is confirmed.</p><p><a href="${trackingUrl}">Track your Creator Hub Boost order</a></p><p>Keep this private link. It gives access to your order status and completed report.</p>`
      });
      res.json({ status: 'under_review', trackingUrl, emailSent, message: emailSent ? 'Payment confirmed. Your tracking link has been emailed.' : 'Payment confirmed. Save your private tracking link below; transactional email is not configured yet.' });
    } catch (error) {
      console.error('Guest service order payment confirmation failed:', error.message);
      res.status(502).json({ error: 'Payment could not be verified right now. Your order has not been marked as paid unless PayPal confirmation succeeds.' });
    }
  });

  serviceRouter.post('/cancel-order', async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'The order database is not configured.' });
    const parsed = z.object({ orderRef: z.string().uuid(), trackingToken: z.string().regex(/^[a-f0-9]{64}$/i) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid order cancellation request.' });
    const updated = await pool.query(
      "UPDATE orders SET status='cancelled' WHERE id=$1 AND status='awaiting_payment' AND tracking_token_hash=$2 RETURNING id",
      [parsed.data.orderRef, hashToken(parsed.data.trackingToken)]
    );
    res.json({ cancelled: Boolean(updated.rows[0]) });
  });

  serviceRouter.get('/track', async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'The order database is not configured.' });
    const reference = String(req.query.reference || '');
    const token = String(req.query.token || '');
    if (!z.string().uuid().safeParse(reference).success || !/^[a-f0-9]{64}$/i.test(token)) return res.status(400).json({ error: 'Enter a valid private order link.' });
    const result = await pool.query(
      'SELECT id,service_name,package_label,amount,currency,target_url,status,created_at,paid_at,completed_at,fulfilment_notes,tracking_token_hash,tracking_token_expires_at FROM orders WHERE id=$1',
      [reference]
    );
    const row = result.rows[0];
    if (!row || !safeTokenMatch(token, row.tracking_token_hash) || new Date(row.tracking_token_expires_at) < new Date()) {
      return res.status(404).json({ error: 'This tracking link is invalid or expired. Request a fresh link by email.' });
    }
    res.json({ order: safeOrder(row) });
  });

  serviceRouter.post('/request-tracking-link', async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'The order database is not configured.' });
    const parsed = referenceInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter the order reference and checkout email.' });
    const result = await pool.query('SELECT id,email FROM orders WHERE id=$1 AND LOWER(email)=LOWER($2)', [parsed.data.reference, parsed.data.email.trim()]);
    const row = result.rows[0];
    if (!row) return res.json({ sent: true, message: 'If those details match an order, a tracking link will be emailed.' });
    const token = randomBytes(32).toString('hex');
    await pool.query(
      'UPDATE orders SET tracking_token_hash=$2,tracking_token_expires_at=NOW()+INTERVAL \'30 days\' WHERE id=$1',
      [row.id, hashToken(token)]
    );
    const trackingUrl = `${publicBaseUrl()}/orders.html?ref=${row.id}&token=${token}`;
    const sent = await sendEmail({
      to: row.email,
      subject: 'Your Creator Hub Boost tracking link',
      text: `Use this private link to track your order: ${trackingUrl}`,
      html: `<p>Here is your private order tracking link:</p><p><a href="${trackingUrl}">Track my order</a></p><p>This link expires in 30 days. Do not share it.</p>`
    });
    if (!sent) return res.status(503).json({ error: 'Email delivery is not configured. Set RESEND_API_KEY and EMAIL_FROM to send tracking links.' });
    res.json({ sent: true, message: 'A private tracking link has been sent to the checkout email.' });
  });

  serviceRouter.get('/admin/service-orders', requireAdmin, async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'The order database is not configured.' });
    const status = String(req.query.status || 'all');
    const params = [];
    let where = '';
    if (status !== 'all') { params.push(status); where = 'WHERE status=$1'; }
    const result = await pool.query(
      `SELECT id,service_name,package_label,amount,currency,target_url,email,status,created_at,paid_at,completed_at,fulfilment_notes
       FROM orders ${where} ORDER BY created_at DESC LIMIT 200`, params
    );
    res.json({ orders: result.rows.map(row => ({ ...safeOrder(row), email: row.email })) });
  });

  serviceRouter.patch('/admin/service-orders/:id', requireAdmin, async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'The order database is not configured.' });
    if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Invalid order reference.' });
        const parsed = adminUpdateInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose a valid order status and a note under 5,000 characters.' });
    if (parsed.data.status === 'completed' && parsed.data.fulfilmentNotes.trim().length < 20) {
      return res.status(400).json({ error: 'Add the actual completed review notes (at least 20 characters) before marking this order complete.' });
    }
    const result = await pool.query(
      `UPDATE orders SET status=$2,fulfilment_notes=$3,
        completed_at=CASE WHEN $2='completed' THEN COALESCE(completed_at,NOW()) ELSE completed_at END
       WHERE id=$1 AND status IN ('under_review','in_progress') RETURNING id,status,fulfilment_notes,completed_at`,
      [req.params.id, parsed.data.status, parsed.data.fulfilmentNotes]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'No active paid service order was found for that reference.' });
    res.json({ order: result.rows[0] });
  });

  return serviceRouter;
}
