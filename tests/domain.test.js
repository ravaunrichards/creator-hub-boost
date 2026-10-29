import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SERVICES, COIN_PACKAGES, TASK_SEEDS, CAMPAIGNS,
  validateOrder, validateTaskSubmission, validateCampaignOrder, validateTikTokUrl, paypalBaseUrl
} from '../server/domain.js';

const validTikTokUrl = 'https://www.tiktok.com/@sample/video/123456789';
const goodLegacyOrder = { serviceId: 'video-views', packageId: 'views-1k', targetUrl: validTikTokUrl, email: 'customer@example.com', policyAccepted: true };
const goodTask = { taskId: 'video-feedback', targetUrl: validTikTokUrl, responseText: 'The opening is clear, but adding captions would help viewers follow the main point.' };

test('service, task, coin-package and campaign identifiers are unique and valid', () => {
  assert.equal(new Set(SERVICES.map(service => service.id)).size, SERVICES.length);
  assert.equal(new Set(COIN_PACKAGES.map(pack => pack.id)).size, COIN_PACKAGES.length);
  assert.equal(new Set(TASK_SEEDS.map(task => task.id)).size, TASK_SEEDS.length);
  assert.equal(new Set(CAMPAIGNS.map(campaign => campaign.id)).size, CAMPAIGNS.length);
  for (const service of SERVICES) {
    assert.equal(new Set(service.packages.map(pack => pack.id)).size, service.packages.length);
    for (const pack of service.packages) assert.ok(pack.price > 0);
  }
  for (const pack of COIN_PACKAGES) {
    assert.ok(Number.isSafeInteger(pack.coins) && pack.coins > 0);
    assert.ok(Number.isFinite(pack.price) && pack.price > 0);
    assert.equal(pack.currency, 'USD');
  }
  const campaignPackageIds = CAMPAIGNS.flatMap(campaign => campaign.packages.map(pack => pack.id));
  assert.equal(new Set(campaignPackageIds).size, campaignPackageIds.length);
  for (const campaign of CAMPAIGNS) for (const pack of campaign.packages) assert.ok(Number.isSafeInteger(pack.coins) && pack.coins > 0);
});

test('legacy order pricing comes from the server catalogue and normalizes email', () => {
  const order = validateOrder({ ...goodLegacyOrder, email: ' CUSTOMER@Example.com ' });
  assert.equal(order.amount, 2.99);
  assert.equal(order.email, 'customer@example.com');
  assert.equal(order.currency, 'USD');
  assert.equal(order.status, 'awaiting_payment');
});

test('task submissions require a valid active task, TikTok URL and useful feedback', () => {
  const task = validateTaskSubmission(goodTask);
  assert.equal(task.taskId, 'video-feedback');
  assert.equal(task.targetUrl, validTikTokUrl);
  assert.ok(task.responseText.length >= 20);
  assert.throws(() => validateTaskSubmission({ ...goodTask, taskId: 'unknown-task' }), /valid active task/);
  assert.throws(() => validateTaskSubmission({ ...goodTask, responseText: 'too short' }), /20 and 3,000/);
});

test('campaign package choice and authorization are validated on the server', () => {
  const campaignOrder = validateCampaignOrder({ campaignId: 'creator-spotlight', packageId: 'spotlight-3day', targetUrl: validTikTokUrl, policyAccepted: true });
  assert.equal(campaignOrder.coinsCost, 350);
  assert.equal(campaignOrder.packageLabel, '3-day spotlight');
  assert.throws(() => validateCampaignOrder({ campaignId: 'creator-spotlight', packageId: 'invented', targetUrl: validTikTokUrl, policyAccepted: true }), /valid campaign package/);
  assert.throws(() => validateCampaignOrder({ campaignId: 'creator-spotlight', packageId: 'spotlight-3day', targetUrl: validTikTokUrl, policyAccepted: false }), /authorized/);
});

test('TikTok URL validation rejects non-HTTPS links and host spoofing', () => {
  assert.throws(() => validateTikTokUrl('http://www.tiktok.com/@sample'), /HTTPS/);
  assert.throws(() => validateTikTokUrl('https://tiktok.com.attacker.example/@sample'), /HTTPS/);
  assert.throws(() => validateTikTokUrl('https://example.com/@sample'), /HTTPS/);
  assert.throws(() => validateTikTokUrl('javascript:alert(1)'), /HTTPS/);
});

test('legacy order rejects unknown packages, invalid email and missing authorization', () => {
  assert.throws(() => validateOrder({ ...goodLegacyOrder, packageId: 'made-up' }), /valid package/);
  assert.throws(() => validateOrder({ ...goodLegacyOrder, email: 'bad-email' }), /valid email/);
  assert.throws(() => validateOrder({ ...goodLegacyOrder, policyAccepted: false }), /authorized/);
});

test('PayPal uses sandbox by default and live only when explicitly selected', () => {
  assert.match(paypalBaseUrl('sandbox'), /sandbox/);
  assert.equal(paypalBaseUrl('live'), 'https://api-m.paypal.com');
  assert.equal(paypalBaseUrl('anything-else'), 'https://api-m.sandbox.paypal.com');
});
