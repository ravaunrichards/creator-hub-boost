import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { z } from 'zod';
import { COIN_PACKAGES, CAMPAIGNS, SERVICES, validateTaskSubmission, validateCampaignOrder, validateTikTokUrl, paypalBaseUrl } from './domain.js';

if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.startsWith('replace-'))) {
  throw new Error('Production startup requires a real JWT_SECRET with at least 32 characters.');
}

const app = express();
const { Pool } = pg;
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false })
  : null;

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.PUBLIC_APP_URL || 'http://localhost:3000' }));
app.use(express.json({ limit: '20kb' }));
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(express.static('public'));

const publicBaseUrl = () => (process.env.PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
function jwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be configured in production.');
  return 'local-development-only-secret-change-before-deploy';
}
function requireDatabase(res) {
  if (!pool) {
    res.status(503).json({ error: 'Database is not configured. Set DATABASE_URL and apply the database schema.' });
    return false;
  }
  return true;
}
function issueUserToken(user) {
  return jwt.sign({ sub: user.id, purpose: 'user-access' }, jwtSecret(), { expiresIn: '12h' });
}
function requireUser(req, res, next) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try {
    const claims = jwt.verify(token, jwtSecret());
    if (claims.purpose !== 'user-access' || !claims.sub) throw new Error('Invalid access token.');
    req.userId = claims.sub;
    next();
  } catch {
    res.status(401).json({ error: 'Sign in to continue.' });
  }
}
function requireAdmin(req, res, next) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try {
    const claims = jwt.verify(token, jwtSecret());
    if (claims.purpose !== 'admin-access' || claims.role !== 'admin') throw new Error('Invalid administrator token.');
    req.adminEmail = claims.email;
    next();
  } catch {
    res.status(401).json({ error: 'Administrator sign-in is required.' });
  }
}
async function paypalAccessToken() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('PayPal is not configured. Add the PayPal REST app credentials to the server environment.');
  const response = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  if (!response.ok) throw new Error('PayPal authentication failed. Check the configured credentials and PAYPAL_ENV.');
  const payload = await response.json();
  if (!payload.access_token) throw new Error('PayPal did not return an access token.');
  return payload.access_token;
}
function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}
function asCoins(value) {
  const coins = Number(value);
  return Number.isSafeInteger(coins) && coins >= 0 ? coins : 0;
}

app.get('/api/health', async (_req, res) => {
  let database = 'not_configured';
  if (pool) {
    try { await pool.query('SELECT 1'); database = 'connected'; }
    catch { database = 'unavailable'; }
  }
  res.status(database === 'unavailable' ? 503 : 200).json({ ok: database !== 'unavailable', service: 'Creator Hub Boost', database });
});

app.get('/api/catalogue', (_req, res) => {
  res.json({ coinPackages: COIN_PACKAGES, campaigns: CAMPAIGNS, currency: 'USD' });
});
app.get('/api/services', (_req, res) => res.json({ services: SERVICES, currency: 'USD', note: 'The supported purchase flow uses the virtual coin wallet.' }));
app.get('/api/coin-packages', (_req, res) => res.json({ packages: COIN_PACKAGES, currency: 'USD' }));
app.get('/api/campaigns', (_req, res) => res.json({ campaigns: CAMPAIGNS }));

const registerSchema = z.object({
  displayName: z.string().trim().min(1).max(40),
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(200)
});
app.post('/api/auth/register', async (req, res) => {
  if (!requireDatabase(res)) return;
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a display name, valid email address, and password of at least 10 characters.' });
  const email = normalizeEmail(parsed.data.email);
  const displayName = parsed.data.displayName.trim();
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'INSERT INTO users (email, display_name, password_hash) VALUES ($1,$2,$3) RETURNING id, email, display_name',
      [email, displayName, passwordHash]
    );
    const user = result.rows[0];
    await client.query('INSERT INTO wallets (user_id, balance) VALUES ($1,0)', [user.id]);
    await client.query('COMMIT');
    res.status(201).json({ token: issueUserToken(user), user: { id: user.id, email: user.email, displayName: user.display_name }, wallet: { balance: 0 } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return res.status(409).json({ error: 'An account with that email already exists. Sign in instead.' });
    console.error('Registration failed:', error.message);
    res.status(500).json({ error: 'Could not create the account. Check database configuration and try again.' });
  } finally { client.release(); }
});

const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(200) });
app.post('/api/auth/login', async (req, res) => {
  if (!requireDatabase(res)) return;
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email address and password.' });
  try {
    const result = await pool.query('SELECT id, email, display_name, password_hash FROM users WHERE email=$1', [normalizeEmail(parsed.data.email)]);
    const row = result.rows[0];
    if (!row || !(await bcrypt.compare(parsed.data.password, row.password_hash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
    const user = { id: row.id, email: row.email, display_name: row.display_name };
    const walletResult = await pool.query('SELECT balance FROM wallets WHERE user_id=$1', [row.id]);
    res.json({ token: issueUserToken(user), user: { id: row.id, email: row.email, displayName: row.display_name }, wallet: { balance: asCoins(walletResult.rows[0]?.balance) } });
  } catch (error) {
    console.error('Login failed:', error.message);
    res.status(500).json({ error: 'Unable to sign in right now.' });
  }
});

app.get('/api/me', requireUser, async (req, res) => {
  if (!requireDatabase(res)) return;
  try {
    const result = await pool.query(
      'SELECT u.id, u.email, u.display_name, u.created_at, COALESCE(w.balance,0) AS balance FROM users u LEFT JOIN wallets w ON w.user_id=u.id WHERE u.id=$1',
      [req.userId]
    );
    if (!result.rows[0]) return res.status(401).json({ error: 'Account not found. Sign in again.' });
    const row = result.rows[0];
    res.json({ user: { id: row.id, email: row.email, displayName: row.display_name, createdAt: row.created_at }, wallet: { balance: asCoins(row.balance) } });
  } catch {
    res.status(500).json({ error: 'Unable to load your account.' });
  }
});

app.get('/api/wallet/transactions', requireUser, async (req, res) => {
  if (!requireDatabase(res)) return;
  try {
    const result = await pool.query(
      'SELECT id, direction, amount, transaction_type, description, created_at FROM wallet_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',
      [req.userId]
    );
    res.json({ transactions: result.rows.map(row => ({ id: row.id, direction: row.direction, amount: asCoins(row.amount), type: row.transaction_type, description: row.description, createdAt: row.created_at })) });
  } catch {
    res.status(500).json({ error: 'Unable to load wallet history.' });
  }
});

app.get('/api/tasks', requireUser, async (req, res) => {
  if (!requireDatabase(res)) return;
  try {
    const result = await pool.query(
      `SELECT t.id, t.title, t.description, t.instructions, t.reward_coins,
              s.id AS submission_id, s.status AS submission_status, s.review_note, s.submitted_at
       FROM tasks t
       LEFT JOIN task_submissions s ON s.task_id=t.id AND s.user_id=$1
       WHERE t.is_active=TRUE
       ORDER BY t.reward_coins DESC, t.title ASC`,
      [req.userId]
    );
    res.json({ tasks: result.rows.map(row => ({ id: row.id, title: row.title, description: row.description, instructions: row.instructions, rewardCoins: row.reward_coins, submission: row.submission_id ? { id: row.submission_id, status: row.submission_status, reviewNote: row.review_note, submittedAt: row.submitted_at } : null })) });
  } catch {
    res.status(500).json({ error: 'Unable to load tasks. Apply db/schema.sql or db/migrations/001_rewards_wallet.sql.' });
  }
});

const taskSubmissionBodySchema = z.object({ targetUrl: z.string().max(500), responseText: z.string().trim().min(20).max(3000) });
app.post('/api/tasks/:taskId/submissions', requireUser, async (req, res) => {
  if (!requireDatabase(res)) return;
  const body = taskSubmissionBodySchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Enter a public TikTok URL and feedback between 20 and 3,000 characters.' });
  try {
    const taskResult = await pool.query('SELECT id, reward_coins FROM tasks WHERE id=$1 AND is_active=TRUE', [req.params.taskId]);
    if (!taskResult.rows[0]) return res.status(404).json({ error: 'That task is no longer available.' });
    const validated = validateTaskSubmission({ taskId: req.params.taskId, ...body.data }, [taskResult.rows[0].id]);
    const result = await pool.query(
      `INSERT INTO task_submissions (task_id,user_id,target_url,response_text,reward_coins)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (task_id,user_id) DO UPDATE SET
         target_url=EXCLUDED.target_url, response_text=EXCLUDED.response_text, status='pending',
         reward_coins=EXCLUDED.reward_coins, review_note=NULL, submitted_at=NOW(), reviewed_at=NULL
       WHERE task_submissions.status='rejected'
       RETURNING id, status, reward_coins, submitted_at`,
      [validated.taskId, req.userId, validated.targetUrl, validated.responseText, taskResult.rows[0].reward_coins]
    );
    if (!result.rows[0]) return res.status(409).json({ error: 'You have already submitted this task. Wait for review before trying again.' });
    const row = result.rows[0];
    res.status(201).json({ submission: { id: row.id, status: row.status, rewardCoins: row.reward_coins, submittedAt: row.submitted_at }, message: 'Task submitted. Coins are credited only after a reviewer approves the work.' });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not submit this task.' });
  }
});

app.post('/api/coins/create-order', requireUser, async (req, res) => {
  if (!requireDatabase(res)) return;
  const parsed = z.object({ packageId: z.string().max(80) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Select a valid coin package.' });
  const pack = COIN_PACKAGES.find(item => item.id === parsed.data.packageId);
  if (!pack) return res.status(400).json({ error: 'Select a valid coin package.' });
  const purchaseId = randomUUID();
  try {
    await pool.query(
      `INSERT INTO coin_purchases (id,user_id,package_id,coins,amount,currency,status)
       VALUES ($1,$2,$3,$4,$5,$6,'awaiting_payment')`,
      [purchaseId, req.userId, pack.id, pack.coins, pack.price, pack.currency]
    );
    const accessToken = await paypalAccessToken();
    const response = await fetch(`${paypalBaseUrl()}/v2/checkout/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': purchaseId },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: purchaseId,
          custom_id: purchaseId,
          description: `${pack.coins} Creator Hub Boost coins`,
          amount: { currency_code: pack.currency, value: pack.price.toFixed(2) }
        }],
        application_context: {
          brand_name: 'Creator Hub Boost',
          user_action: 'PAY_NOW',
          return_url: `${publicBaseUrl()}/?payment=return&purchase=${purchaseId}`,
          cancel_url: `${publicBaseUrl()}/?payment=cancel&purchase=${purchaseId}`
        }
      })
    });
    const data = await response.json().catch(() => ({}));
    const approveUrl = data.links?.find(link => link.rel === 'approve')?.href;
    if (!response.ok || !data.id || !approveUrl) {
      await pool.query("UPDATE coin_purchases SET status='failed' WHERE id=$1 AND status='awaiting_payment'", [purchaseId]);
      return res.status(502).json({ error: 'PayPal could not create checkout. Check the merchant credentials and environment.' });
    }
    await pool.query('UPDATE coin_purchases SET paypal_order_id=$2 WHERE id=$1', [purchaseId, data.id]);
    res.status(201).json({ purchaseId, coins: pack.coins, amount: pack.price, currency: pack.currency, paypalOrderId: data.id, approveUrl });
  } catch (error) {
    await pool.query("UPDATE coin_purchases SET status='failed' WHERE id=$1 AND status='awaiting_payment'", [purchaseId]).catch(() => {});
    res.status(502).json({ error: error.message || 'Unable to start PayPal checkout.' });
  }
});

app.post('/api/coins/capture-order', requireUser, async (req, res) => {
  if (!requireDatabase(res)) return;
  const parsed = z.object({ purchaseId: z.string().uuid(), paypalOrderId: z.string().min(3).max(120) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payment confirmation.' });
  const { purchaseId, paypalOrderId } = parsed.data;
  try {
    const purchaseResult = await pool.query(
      'SELECT id,user_id,coins,amount,currency,status,paypal_order_id FROM coin_purchases WHERE id=$1 AND user_id=$2',
      [purchaseId, req.userId]
    );
    const purchase = purchaseResult.rows[0];
    if (!purchase || purchase.paypal_order_id !== paypalOrderId) return res.status(404).json({ error: 'Payment does not match your purchase.' });
    if (purchase.status === 'paid') {
      const wallet = await pool.query('SELECT balance FROM wallets WHERE user_id=$1', [req.userId]);
      return res.json({ status: 'paid', balance: asCoins(wallet.rows[0]?.balance), message: 'This coin purchase was already credited.' });
    }
    if (purchase.status !== 'awaiting_payment') return res.status(409).json({ error: 'This purchase is not awaiting payment.' });

    const accessToken = await paypalAccessToken();
    const response = await fetch(`${paypalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `capture-${purchaseId}` }
    });
    const capture = await response.json().catch(() => ({}));
    const purchaseUnit = capture.purchase_units?.find(unit => unit.custom_id === purchaseId || unit.reference_id === purchaseId) || capture.purchase_units?.[0];
    const captureUnit = purchaseUnit?.payments?.captures?.[0];
    const amountMatches = captureUnit?.amount?.currency_code === purchase.currency && Number(captureUnit?.amount?.value) === Number(purchase.amount);
    if (!response.ok || capture.status !== 'COMPLETED' || !purchaseUnit || (purchaseUnit.custom_id !== purchaseId && purchaseUnit.reference_id !== purchaseId) || !captureUnit?.id || !amountMatches) {
      return res.status(402).json({ error: 'PayPal has not confirmed the exact expected payment. No coins were credited.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lockedResult = await client.query('SELECT id,user_id,coins,status FROM coin_purchases WHERE id=$1 AND user_id=$2 FOR UPDATE', [purchaseId, req.userId]);
      const locked = lockedResult.rows[0];
      if (!locked) throw new Error('Coin purchase could not be found.');
      if (locked.status === 'paid') {
        await client.query('COMMIT');
        const wallet = await pool.query('SELECT balance FROM wallets WHERE user_id=$1', [req.userId]);
        return res.json({ status: 'paid', balance: asCoins(wallet.rows[0]?.balance), message: 'This coin purchase was already credited.' });
      }
      if (locked.status !== 'awaiting_payment') throw new Error('This purchase is no longer awaiting payment.');
      await client.query("UPDATE coin_purchases SET status='paid', paypal_capture_id=$2, paid_at=NOW() WHERE id=$1", [purchaseId, captureUnit.id]);
      const walletResult = await client.query(
        `INSERT INTO wallets (user_id,balance) VALUES ($1,$2)
         ON CONFLICT (user_id) DO UPDATE SET balance=wallets.balance+EXCLUDED.balance, updated_at=NOW()
         RETURNING balance`,
        [req.userId, locked.coins]
      );
      await client.query(
        `INSERT INTO wallet_transactions (user_id,direction,amount,transaction_type,reference_id,idempotency_key,description)
         VALUES ($1,'credit',$2,'coin_purchase',$3,$4,$5)`,
        [req.userId, locked.coins, purchaseId, `coin-purchase:${purchaseId}`, `PayPal coin package — ${locked.coins} coins`]
      );
      await client.query('COMMIT');
      res.json({ status: 'paid', balance: asCoins(walletResult.rows[0].balance), coinsAdded: asCoins(locked.coins), message: 'Payment confirmed and coins added to your wallet.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Coin credit transaction failed:', error.message);
      res.status(409).json({ error: 'Payment was received but the wallet could not be updated safely. Contact support with purchase reference ' + purchaseId + '.' });
    } finally { client.release(); }
  } catch (error) {
    console.error('PayPal capture verification failed:', error.message);
    res.status(502).json({ error: error.message || 'Unable to verify PayPal payment.' });
  }
});

const campaignBodySchema = z.object({
  campaignId: z.string().max(80),
  packageId: z.string().max(80),
  targetUrl: z.string().max(500),
  policyAccepted: z.boolean()
});
app.post('/api/campaign-orders', requireUser, async (req, res) => {
  if (!requireDatabase(res)) return;
  const parsed = campaignBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose a campaign and package, enter a public TikTok URL, and confirm authorization.' });
  let order;
  try { order = validateCampaignOrder(parsed.data); }
  catch (error) { return res.status(400).json({ error: error.message }); }

  const orderId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const walletResult = await client.query('SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE', [req.userId]);
    const balance = asCoins(walletResult.rows[0]?.balance);
    if (balance < order.coinsCost) {
      await client.query('ROLLBACK');
      return res.status(402).json({ error: `Not enough coins. This campaign costs ${order.coinsCost.toLocaleString()} coins; your balance is ${balance.toLocaleString()}.`, balance });
    }
    await client.query(
      `INSERT INTO campaign_orders (id,user_id,campaign_id,campaign_name,package_id,package_label,target_url,coins_cost,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'queued_for_review')`,
      [orderId, req.userId, order.campaignId, order.campaignName, order.packageId, order.packageLabel, order.targetUrl, order.coinsCost]
    );
    const updatedWallet = await client.query('UPDATE wallets SET balance=balance-$2,updated_at=NOW() WHERE user_id=$1 RETURNING balance', [req.userId, order.coinsCost]);
    await client.query(
      `INSERT INTO wallet_transactions (user_id,direction,amount,transaction_type,reference_id,idempotency_key,description)
       VALUES ($1,'debit',$2,'campaign_spend',$3,$4,$5)`,
      [req.userId, order.coinsCost, orderId, `campaign-spend:${orderId}`, `Campaign order: ${order.packageLabel}`]
    );
    await client.query('COMMIT');
    res.status(201).json({ order: { id: orderId, campaignName: order.campaignName, packageLabel: order.packageLabel, coinsCost: order.coinsCost, status: 'queued_for_review' }, wallet: { balance: asCoins(updatedWallet.rows[0].balance) }, message: 'Campaign request submitted for review. No external engagement delivery is claimed by this starter.' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Campaign order failed:', error.message);
    res.status(500).json({ error: 'Could not create the campaign order.' });
  } finally { client.release(); }
});

app.get('/api/campaign-orders', requireUser, async (req, res) => {
  if (!requireDatabase(res)) return;
  try {
    const result = await pool.query(
      'SELECT id,campaign_name,package_label,target_url,coins_cost,status,created_at,updated_at FROM campaign_orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',
      [req.userId]
    );
    res.json({ orders: result.rows.map(row => ({ id: row.id, campaignName: row.campaign_name, packageLabel: row.package_label, targetUrl: row.target_url, coinsCost: asCoins(row.coins_cost), status: row.status, createdAt: row.created_at, updatedAt: row.updated_at })) });
  } catch {
    res.status(500).json({ error: 'Unable to load campaign orders.' });
  }
});

app.post('/api/admin/login', async (req, res) => {
  const parsed = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) }).safeParse(req.body);
  if (!parsed.success || !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD_HASH || normalizeEmail(parsed.data.email) !== normalizeEmail(process.env.ADMIN_EMAIL)) {
    return res.status(401).json({ error: 'Invalid administrator credentials.' });
  }
  try {
    if (!(await bcrypt.compare(parsed.data.password, process.env.ADMIN_PASSWORD_HASH))) return res.status(401).json({ error: 'Invalid administrator credentials.' });
    res.json({ token: jwt.sign({ role: 'admin', purpose: 'admin-access', email: normalizeEmail(parsed.data.email) }, jwtSecret(), { expiresIn: '2h' }) });
  } catch (error) {
    res.status(503).json({ error: error.message || 'Administrator sign-in is not configured.' });
  }
});

app.get('/api/admin/task-submissions', requireAdmin, async (req, res) => {
  if (!requireDatabase(res)) return;
  const status = String(req.query.status || 'pending');
  if (!['pending','approved','rejected','all'].includes(status)) return res.status(400).json({ error: 'Invalid submission status filter.' });
  try {
    const result = await pool.query(
      `SELECT s.id,s.task_id,s.user_id,u.email,t.title,t.reward_coins,s.target_url,s.response_text,
              s.status,s.review_note,s.submitted_at,s.reviewed_at
       FROM task_submissions s
       JOIN users u ON u.id=s.user_id
       JOIN tasks t ON t.id=s.task_id
       WHERE ($1='all' OR s.status=$1)
       ORDER BY s.submitted_at ASC LIMIT 300`,
      [status]
    );
    res.json({ submissions: result.rows });
  } catch {
    res.status(500).json({ error: 'Unable to load task submissions.' });
  }
});

app.patch('/api/admin/task-submissions/:id', requireAdmin, async (req, res) => {
  if (!requireDatabase(res)) return;
  const parsed = z.object({ status: z.enum(['approved','rejected']), reviewNote: z.string().trim().max(500).optional().default('') }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose approved or rejected and provide a review note under 500 characters.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT s.id,s.user_id,s.task_id,s.status,t.reward_coins,t.title
       FROM task_submissions s JOIN tasks t ON t.id=s.task_id
       WHERE s.id=$1 FOR UPDATE OF s`,
      [req.params.id]
    );
    const submission = result.rows[0];
    if (!submission) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Task submission not found.' });
    }
    if (submission.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This submission has already been reviewed.' });
    }
    if (parsed.data.status === 'approved') {
      await client.query(
        `INSERT INTO wallets (user_id,balance) VALUES ($1,$2)
         ON CONFLICT (user_id) DO UPDATE SET balance=wallets.balance+EXCLUDED.balance,updated_at=NOW()`,
        [submission.user_id, submission.reward_coins]
      );
      await client.query(
        `INSERT INTO wallet_transactions (user_id,direction,amount,transaction_type,reference_id,idempotency_key,description)
         VALUES ($1,'credit',$2,'task_reward',$3,$4,$5)`,
        [submission.user_id, submission.reward_coins, submission.id, `task-reward:${submission.id}`, `Approved task reward: ${submission.title}`]
      );
    }
    const updated = await client.query(
      'UPDATE task_submissions SET status=$2,review_note=$3,reviewed_at=NOW() WHERE id=$1 RETURNING id,status,reward_coins,review_note,reviewed_at',
      [submission.id, parsed.data.status, parsed.data.reviewNote || null]
    );
    await client.query('COMMIT');
    res.json({ submission: updated.rows[0], creditedCoins: parsed.data.status === 'approved' ? submission.reward_coins : 0 });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Task review failed:', error.message);
    res.status(500).json({ error: 'Could not review this task submission.' });
  } finally { client.release(); }
});

app.get('/api/admin/campaign-orders', requireAdmin, async (req, res) => {
  if (!requireDatabase(res)) return;
  const status = String(req.query.status || 'queued_for_review');
  if (!['queued_for_review','in_progress','completed','cancelled','refunded','all'].includes(status)) return res.status(400).json({ error: 'Invalid campaign order status filter.' });
  try {
    const result = await pool.query(
      `SELECT c.id,c.user_id,u.email,c.campaign_name,c.package_label,c.target_url,c.coins_cost,c.status,c.created_at,c.updated_at
       FROM campaign_orders c JOIN users u ON u.id=c.user_id
       WHERE ($1='all' OR c.status=$1)
       ORDER BY c.created_at ASC LIMIT 300`,
      [status]
    );
    res.json({ orders: result.rows });
  } catch {
    res.status(500).json({ error: 'Unable to load campaign orders.' });
  }
});

app.patch('/api/admin/campaign-orders/:id', requireAdmin, async (req, res) => {
  if (!requireDatabase(res)) return;
  const parsed = z.object({ status: z.enum(['in_progress','completed','cancelled','refunded']) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid campaign order status.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT id,user_id,coins_cost,status,campaign_name FROM campaign_orders WHERE id=$1 FOR UPDATE', [req.params.id]);
    const order = result.rows[0];
    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Campaign order not found.' });
    }
    if (['completed','cancelled','refunded'].includes(order.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This campaign order is already in a final status.' });
    }
    const nextStatus = parsed.data.status;
    if (nextStatus === 'cancelled' || nextStatus === 'refunded') {
      await client.query(
        `INSERT INTO wallets (user_id,balance) VALUES ($1,$2)
         ON CONFLICT (user_id) DO UPDATE SET balance=wallets.balance+EXCLUDED.balance,updated_at=NOW()`,
        [order.user_id, order.coins_cost]
      );
      await client.query(
        `INSERT INTO wallet_transactions (user_id,direction,amount,transaction_type,reference_id,idempotency_key,description)
         VALUES ($1,'credit',$2,'campaign_refund',$3,$4,$5)`,
        [order.user_id, order.coins_cost, order.id, `campaign-refund:${order.id}`, `Campaign coin refund: ${order.campaign_name}`]
      );
    }
    const updated = await client.query('UPDATE campaign_orders SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING id,status,coins_cost', [order.id, nextStatus]);
    await client.query('COMMIT');
    res.json({ order: updated.rows[0], refundedCoins: nextStatus === 'cancelled' || nextStatus === 'refunded' ? asCoins(order.coins_cost) : 0 });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Campaign status update failed:', error.message);
    res.status(500).json({ error: 'Could not update the campaign order.' });
  } finally { client.release(); }
});

app.use((error, _req, res, _next) => {
  console.error('Unhandled request error:', error.message);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Creator Hub Boost listening on port ${port}`));
