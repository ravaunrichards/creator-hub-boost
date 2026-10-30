import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCompletedCapture, matchesExpectedPayment } from '../server/paypal-webhooks.js';

const goodEvent = {
  id: 'WH-EVENT-001',
  event_type: 'PAYMENT.CAPTURE.COMPLETED',
  resource: {
    id: 'CAPTURE-001',
    amount: { currency_code: 'USD', value: '9.99' },
    supplementary_data: { related_ids: { order_id: 'ORDER-001' } }
  }
};

test('normalizes a completed capture and related checkout order', () => {
  assert.deepEqual(extractCompletedCapture(goodEvent), {
    orderId: 'ORDER-001', captureId: 'CAPTURE-001', amount: '9.99', currency: 'USD'
  });
});
test('does not let unrelated event types trigger wallet credit', () => {
  assert.equal(extractCompletedCapture({ ...goodEvent, event_type: 'CHECKOUT.ORDER.APPROVED' }), null);
});
test('rejects incomplete identifiers, invalid currency and malformed amounts', () => {
  assert.equal(extractCompletedCapture({ ...goodEvent, resource: { ...goodEvent.resource, id: '' } }), null);
  assert.equal(extractCompletedCapture({ ...goodEvent, resource: { ...goodEvent.resource, amount: { currency_code: 'US$', value: '9.99' } } }), null);
  assert.equal(extractCompletedCapture({ ...goodEvent, resource: { ...goodEvent.resource, amount: { currency_code: 'USD', value: '9.999' } } }), null);
  assert.equal(extractCompletedCapture({ ...goodEvent, resource: { ...goodEvent.resource, supplementary_data: undefined } }), null);
});
test('accepts only an exact amount and currency match', () => {
  const capture = extractCompletedCapture(goodEvent);
  assert.equal(matchesExpectedPayment({ amount: '9.99', currency: 'USD' }, capture), true);
  assert.equal(matchesExpectedPayment({ amount: '10.00', currency: 'USD' }, capture), false);
  assert.equal(matchesExpectedPayment({ amount: '9.99', currency: 'JMD' }, capture), false);
});
test('does not round invalid three-decimal purchase amounts', () => {
  assert.equal(matchesExpectedPayment({ amount: '9.990', currency: 'USD' }, extractCompletedCapture(goodEvent)), false);
  assert.equal(matchesExpectedPayment({ amount: '9.99', currency: ' usd ' }, extractCompletedCapture(goodEvent)), true);
});
