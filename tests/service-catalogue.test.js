import test from 'node:test';
import assert from 'node:assert/strict';
import { SERVICE_CATALOGUE, findServicePackage } from '../server/service-catalogue.js';

test('guest service catalogue has unique service and package identifiers', () => {
  const serviceIds = SERVICE_CATALOGUE.map(item => item.id);
  const packageIds = SERVICE_CATALOGUE.flatMap(item => item.packages.map(pack => pack.id));
  assert.equal(new Set(serviceIds).size, serviceIds.length);
  assert.equal(new Set(packageIds).size, packageIds.length);
});

test('every guest package has a positive server-defined price and real deliverable', () => {
  for (const service of SERVICE_CATALOGUE) {
    assert.ok(['profile','video'].includes(service.targetType));
    assert.ok(service.name && service.description);
    for (const pack of service.packages) {
      assert.ok(Number.isSafeInteger(Math.round(pack.price * 100)) && pack.price > 0);
      assert.equal(pack.currency, 'USD');
      assert.ok(pack.quantity > 0);
      assert.ok(pack.deliverable.length > 20);
    }
  }
});

test('package lookup rejects client-selected unknown packages', () => {
  assert.equal(findServicePackage('profile-review','not-a-package'), null);
  assert.equal(findServicePackage('not-a-service','profile-quick'), null);
  assert.equal(findServicePackage('profile-review','profile-quick').pack.price, 4.99);
});
