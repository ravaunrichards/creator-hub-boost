import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { z } from 'zod';
import { SERVICES, validateOrder, paypalBaseUrl } from './domain.js';

const app = express();
const { Pool } = pg;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false }) : null;
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.PUBLIC_APP_URL || 'http://localhost:3000' }));
app.use(express.json({ limit: '20kb' }));
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(express.static('public'));

async function persistOrder(order) {
  if (!pool) throw new Error('Database is not configured. Set DATABASE_URL and apply db/schema.sql.');
  await pool.query(`INSERT INTO orders (id, service_id, service_name, package_id, package_label, amount, currency, target_url, email, status, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [order.id, order.serviceId, order.serviceName, order.packageId, order.packageLabel, order.amount, order.currency, order.targetUrl, order.email, order.status, order.createdAt]);
}

async function paypalAccessToken() {
  const id = process.env.PAYPAL_CLIENT_ID; const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('PayPal is not configured. Add your PayPal API credentials to .env.');
  const response = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  if (!response.ok) throw new Error('PayPal authentication failed. Check the configured API credentials and environment.');
  return (await response.json()).access_token;
}

app.get('/api/health', async (_req, res) => {
  let database = 'not_configured';
  if (pool) { try { await pool.query('SELECT 1'); database = 'connected'; } catch { database = 'unavailable'; } }
  res.status(database === 'unavailable' ? 503 : 200).json({ ok: database !== 'unavailable', service: 'Creator Hub Boost', database });
});
app.get('/api/services', (_req, res) => res.json({ services: SERVICES, currency: 'USD' }));

const orderSchema = z.object({ serviceId: z.string().max(80), packageId: z.string().max(80), targetUrl: z.string().max(500), email: z.string().max(254), policyAccepted: z.boolean() });
app.post('/api/orders', async (req, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Please check the order details.' });
  try {
    const order = validateOrder(parsed.data);
    await persistOrder(order);
    const token = jwt.sign({ orderId: order.id, purpose: 'order-status' }, process.env.JWT_SECRET || 'unsafe-development-secret-change-me', { expiresIn: '14d' });
    res.status(201).json({ order: { id: order.id, serviceName: order.serviceName, packageLabel: order.packageLabel, amount: order.amount, currency: order.currency, status: order.status }, trackingToken: token, message: 'Order saved. Continue to PayPal to authorize payment.' });
  } catch (error) { res.status(400).json({ error: error.message || 'Unable to create order.' }); }
});

app.post('/api/paypal/create-order', async (req, res) => {
  const schema = z.object({ orderId: z.string().uuid(), trackingToken: z.string().min(20) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid order reference.' });
  try {
    const claims = jwt.verify(parsed.data.trackingToken, process.env.JWT_SECRET || 'unsafe-development-secret-change-me');
    if (claims.orderId !== parsed.data.orderId || claims.purpose !== 'order-status') return res.status(403).json({ error: 'Order token mismatch.' });
    if (!pool) throw new Error('Database is not configured.');
    const result = await pool.query('SELECT id, amount, currency, status FROM orders WHERE id=$1', [claims.orderId]);
    const order = result.rows[0];
    if (!order || order.status !== 'awaiting_payment') return res.status(409).json({ error: 'Order is unavailable for payment.' });
    const accessToken = await paypalAccessToken();
    const paypalResponse = await fetch(`${paypalBaseUrl()}/v2/checkout/orders`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': order.id }, body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [{ reference_id: order.id, custom_id: order.id, amount: { currency_code: order.currency, value: Number(order.amount).toFixed(2) }, description: 'Creator Hub Boost campaign order' }], application_context: { brand_name: 'Creator Hub Boost', user_action: 'PAY_NOW', return_url: `${process.env.PUBLIC_APP_URL}/?payment=return&order=${order.id}&tracking=${encodeURIComponent(parsed.data.trackingToken)}`, cancel_url: `${process.env.PUBLIC_APP_URL}/?payment=cancel&order=${order.id}` } }) });
    const data = await paypalResponse.json();
    if (!paypalResponse.ok) return res.status(502).json({ error: 'PayPal could not create checkout. Verify the credentials and try again.' });
    await pool.query('UPDATE orders SET paypal_order_id=$2 WHERE id=$1', [order.id, data.id]);
    res.json({ paypalOrderId: data.id, approveUrl: data.links?.find(link => link.rel === 'approve')?.href });
  } catch (error) { res.status(400).json({ error: error.message || 'Unable to start PayPal checkout.' }); }
});

app.post('/api/paypal/capture-order', async (req, res) => {
  const schema = z.object({ orderId: z.string().uuid(), paypalOrderId: z.string().min(3), trackingToken: z.string().min(20) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payment confirmation.' });
  try {
    const claims = jwt.verify(parsed.data.trackingToken, process.env.JWT_SECRET || 'unsafe-development-secret-change-me');
    if (claims.orderId !== parsed.data.orderId || claims.purpose !== 'order-status') return res.status(403).json({ error: 'Order token mismatch.' });
    if (!pool) throw new Error('Database is not configured.');
    const result = await pool.query('SELECT id, amount, currency, status, paypal_order_id FROM orders WHERE id=$1', [claims.orderId]);
    const order = result.rows[0];
    if (!order || order.paypal_order_id !== parsed.data.paypalOrderId) return res.status(404).json({ error: 'Payment does not match this order.' });
    if (order.status === 'paid') return res.json({ status: 'paid', message: 'Payment already confirmed.' });
    const accessToken = await paypalAccessToken();
    const response = await fetch(`${paypalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(parsed.data.paypalOrderId)}/capture`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
    const capture = await response.json();
    const captureUnit = capture.purchase_units?.[0]?.payments?.captures?.[0];
    if (!response.ok || capture.status !== 'COMPLETED' || captureUnit?.amount?.currency_code !== order.currency || Number(captureUnit?.amount?.value) !== Number(order.amount)) return res.status(402).json({ error: 'Payment was not confirmed. Check PayPal before retrying.' });
    await pool.query('UPDATE orders SET status=$2, paypal_capture_id=$3, paid_at=NOW() WHERE id=$1', [order.id, 'paid', captureUnit.id]);
    res.json({ status: 'paid', message: 'Payment confirmed. Your order is queued for review.' });
  } catch (error) { res.status(400).json({ error: error.message || 'Unable to confirm payment.' }); }
});

app.get('/api/orders/:id/status', async (req, res) => {
  const token = String(req.query.token || '');
  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET || 'unsafe-development-secret-change-me');
    if (claims.orderId !== req.params.id || claims.purpose !== 'order-status') return res.status(403).json({ error: 'Invalid tracking link.' });
    if (!pool) throw new Error('Database is not configured.');
    const result = await pool.query('SELECT id, service_name, package_label, amount, currency, status, created_at, paid_at FROM orders WHERE id=$1', [claims.orderId]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Order not found.' });
    res.json({ order: result.rows[0] });
  } catch (error) { res.status(400).json({ error: error.message || 'Unable to retrieve order.' }); }
});

function requireAdmin(req, res, next) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try { const claims = jwt.verify(token, process.env.JWT_SECRET || 'unsafe-development-secret-change-me'); if (claims.role !== 'admin') throw new Error(); req.admin = claims; next(); }
  catch { res.status(401).json({ error: 'Administrator authentication required.' }); }
}
app.post('/api/admin/login', async (req, res) => {
  const schema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD_HASH || parsed.data.email.toLowerCase() !== process.env.ADMIN_EMAIL.toLowerCase() || !(await bcrypt.compare(parsed.data.password, process.env.ADMIN_PASSWORD_HASH))) return res.status(401).json({ error: 'Invalid administrator credentials.' });
  res.json({ token: jwt.sign({ role: 'admin', email: parsed.data.email }, process.env.JWT_SECRET, { expiresIn: '2h' }) });
});
app.get('/api/admin/orders', requireAdmin, async (_req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database is not configured.' });
  const result = await pool.query('SELECT id, service_name, package_label, amount, currency, target_url, email, status, created_at, paid_at FROM orders ORDER BY created_at DESC LIMIT 200');
  res.json({ orders: result.rows });
});
app.patch('/api/admin/orders/:id/status', requireAdmin, async (req, res) => {
  const parsed = z.object({ status: z.enum(['under_review', 'in_progress', 'completed', 'cancelled', 'refunded']) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid status.' });
  if (!pool) return res.status(503).json({ error: 'Database is not configured.' });
  const result = await pool.query("UPDATE orders SET status=$2 WHERE id=$1 AND status IN ('paid','under_review','in_progress') RETURNING id,status", [req.params.id, parsed.data.status]);
  if (!result.rowCount) return res.status(404).json({ error: 'Order not found or cannot be updated.' });
  res.json({ order: result.rows[0] });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Creator Hub Boost listening on http://localhost:${port}`));
