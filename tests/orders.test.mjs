import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = { querySelector: () => null };
const { orderQuantity, reorderProduct, changeOrder } = await import('../js/orders.js');
const { saveConnection, clearConnection } = await import('../js/auth.js');
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};

test('Bestellmengen erlauben nur positive ganze Stückzahlen im Integer-Bereich', () => {
  assert.equal(orderQuantity('2'), 2);
  assert.equal(orderQuantity(2147483647), 2147483647);
  for (const invalid of ['', ' ', 0, -1, 1.5, '1e2', 2147483648, null, undefined, true]) {
    assert.throws(() => orderQuantity(invalid), /Bestellmenge/);
  }
});

test('Nachbestellen nutzt atomare RPC; Mengenänderung und Entfernen prüfen den Änderungsstand', async () => {
  saveConnection({ inventoryId: '11111111-1111-4111-8111-111111111111', deviceId: 'd', deviceToken: 't' });
  const original = globalThis.fetch;
  const entry = { id: 'order', item_id: 'product', quantity: 2, updated_at: '2026-11-16T22:00:00+00:00' };
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify([entry]));
  };
  try {
    assert.deepEqual(await reorderProduct('product'), entry);
    assert.ok(calls[0].url.endsWith('/rest/v1/rpc/reorder_product'));
    assert.equal(calls[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].options.body), { p_item_id: 'product' });
    assert.deepEqual(await changeOrder(entry, '2'), entry);
    assert.equal(calls[1].options.method, 'PATCH');
    assert.ok(calls[1].url.includes(`updated_at=eq.${encodeURIComponent(entry.updated_at)}`));
    assert.deepEqual(JSON.parse(calls[1].options.body), { quantity: 2 });
    assert.deepEqual(await changeOrder(entry, null), entry);
    assert.equal(calls[2].options.method, 'DELETE');
    assert.equal(calls[2].options.body, undefined);
    await assert.rejects(changeOrder(entry, 0), /Bestellmenge/);
    await assert.rejects(changeOrder({ ...entry, updated_at: null }, 1), /Änderungsstand/);
    assert.equal(calls.length, 3);
    globalThis.fetch = async () => new Response('[]');
    await assert.rejects(changeOrder(entry, 1), /zwischenzeitlich geändert/);
    await assert.rejects(changeOrder(entry, null), /zwischenzeitlich geändert/);
    await assert.rejects(reorderProduct('product'), /nicht bestätigt/);
    globalThis.fetch = async () => new Response('{"message":"Nicht berechtigt"}', { status: 403 });
    await assert.rejects(reorderProduct('product'), /Nicht berechtigt/);
    await assert.rejects(changeOrder(entry, 1), /Nicht berechtigt/);
  } finally {
    globalThis.fetch = original;
    clearConnection();
  }
});
