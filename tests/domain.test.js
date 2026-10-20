import test from 'node:test';
import assert from 'node:assert/strict';
import { SERVICES, validateOrder, paypalBaseUrl } from '../server/domain.js';
const good = { serviceId: 'video-views', packageId: 'views-1k', targetUrl: 'https://www.tiktok.com/@sample/video/123456', email: 'customer@example.com', policyAccepted: true };
test('catalogue has unique service and package ids', () => {
  assert.equal(new Set(SERVICES.map(s => s.id)).size, SERVICES.length);
  for (const service of SERVICES) assert.equal(new Set(service.packages.map(p => p.id)).size, service.packages.length);
});
test('valid order is normalized and priced from server catalogue', () => {
  const order = validateOrder({ ...good, email: ' CUSTOMER@Example.com ' });
  assert.equal(order.amount, 2.99); assert.equal(order.email, 'customer@example.com'); assert.equal(order.currency, 'USD'); assert.equal(order.status, 'awaiting_payment');
});
test('rejects unknown package and invalid external target', () => {
  assert.throws(() => validateOrder({ ...good, packageId: 'made-up', targetUrl: 'https://www.tiktok.com/@sample/video/123' }), /valid package/);
  assert.throws(() => validateOrder({ ...good, targetUrl: 'https://example.com/profile' }), /TikTok URL/);
  assert.throws(() => validateOrder({ ...good, targetUrl: 'http://www.tiktok.com/@sample' }), /TikTok URL/);
});
test('requires authorization checkbox and valid email', () => {
  assert.throws(() => validateOrder({ ...good, policyAccepted: false }), /authorized/);
  assert.throws(() => validateOrder({ ...good, email: 'bad-email' }), /valid email/);
});
test('PayPal environment selects sandbox unless explicitly live', () => {
  assert.match(paypalBaseUrl('sandbox'), /sandbox/); assert.equal(paypalBaseUrl('live'), 'https://api-m.paypal.com');
});
