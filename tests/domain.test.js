import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COIN_PACKAGES, TASK_SEEDS, CAMPAIGNS,
  validateTaskSubmission, validateCampaignOrder, validateTikTokUrl, paypalBaseUrl
} from '../server/domain.js';

const validTikTokUrl = 'https://www.tiktok.com/@sample/video/123456789';
const goodTask = { taskId: 'video-feedback', targetUrl: validTikTokUrl, responseText: 'The opening is clear, but adding captions would help viewers follow the main point.' };

test('service, task, coin-package and campaign identifiers are unique and valid', () => {
  assert.equal(new Set(COIN_PACKAGES.map(pack => pack.id)).size, COIN_PACKAGES.length);
  assert.equal(new Set(TASK_SEEDS.map(task => task.id)).size, TASK_SEEDS.length);
  assert.equal(new Set(CAMPAIGNS.map(campaign => campaign.id)).size, CAMPAIGNS.length);
  for (const pack of COIN_PACKAGES) {
    assert.ok(Number.isSafeInteger(pack.coins) && pack.coins > 0);
    assert.ok(Number.isFinite(pack.price) && pack.price > 0);
    assert.equal(pack.currency, 'USD');
  }
  const campaignPackageIds = CAMPAIGNS.flatMap(campaign => campaign.packages.map(pack => pack.id));
  assert.equal(new Set(campaignPackageIds).size, campaignPackageIds.length);
  for (const campaign of CAMPAIGNS) for (const pack of campaign.packages) { assert.ok(Number.isSafeInteger(pack.coins) && pack.coins > 0); assert.ok(Number.isSafeInteger(pack.responseCount) && pack.responseCount > 0); assert.ok(Number.isSafeInteger(pack.rewardCoinsPerResponse) && pack.rewardCoinsPerResponse > 0); }
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
  const campaignOrder = validateCampaignOrder({ campaignId: 'video-feedback-panel', packageId: 'feedback-15', targetUrl: validTikTokUrl, policyAccepted: true });
  assert.equal(campaignOrder.coinsCost, 600);
  assert.equal(campaignOrder.packageLabel, '15 feedback responses');
  assert.equal(campaignOrder.responseCount, 15);
  assert.equal(campaignOrder.rewardCoinsPerResponse, 30);
  assert.throws(() => validateCampaignOrder({ campaignId: 'video-feedback-panel', packageId: 'invented', targetUrl: validTikTokUrl, policyAccepted: true }), /valid campaign package/);
  assert.throws(() => validateCampaignOrder({ campaignId: 'video-feedback-panel', packageId: 'feedback-15', targetUrl: validTikTokUrl, policyAccepted: false }), /authorized/);
});

test('TikTok URL validation rejects non-HTTPS links and host spoofing', () => {
  assert.throws(() => validateTikTokUrl('http://www.tiktok.com/@sample'), /HTTPS/);
  assert.throws(() => validateTikTokUrl('https://tiktok.com.attacker.example/@sample'), /HTTPS/);
  assert.throws(() => validateTikTokUrl('https://example.com/@sample'), /HTTPS/);
  assert.throws(() => validateTikTokUrl('javascript:alert(1)'), /HTTPS/);
});

test('PayPal uses sandbox by default and live only when explicitly selected', () => {
  assert.match(paypalBaseUrl('sandbox'), /sandbox/);
  assert.equal(paypalBaseUrl('live'), 'https://api-m.paypal.com');
  assert.equal(paypalBaseUrl('anything-else'), 'https://api-m.sandbox.paypal.com');
});
