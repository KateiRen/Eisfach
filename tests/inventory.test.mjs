import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = { querySelector: () => null };
const { hasStock, optionalInteger, stockValues } = await import('../js/inventory.js');
const { saveConnection, clearConnection, saveSnapshot, loadSnapshot } = await import('../js/auth.js');

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};

test('Bestand umfasst Stückzahl oder Gewicht, aber keine leeren Positionen', () => {
  assert.equal(hasStock({ quantity: 0, weight_grams: null }), false);
  assert.equal(hasStock({ quantity: 0, weight_grams: '0.000' }), false);
  assert.equal(hasStock({ quantity: 1, weight_grams: null }), true);
  assert.equal(hasStock({ quantity: 0, weight_grams: '0.001' }), true);
});

test('Stückzahl, Gesamtgewicht und Zeiten beachten Grenzen und optionale Werte', () => {
  assert.deepEqual(stockValues({ quantity: '0', weight_grams: '' }), { quantity: 0, weight_grams: null });
  assert.deepEqual(stockValues({ quantity: '2147483647', weight_grams: '999999999.999' }),
    { quantity: 2147483647, weight_grams: 999999999.999 });
  for (const fields of [
    { quantity: '', weight_grams: '' }, { quantity: '1.5', weight_grams: '' },
    { quantity: '2147483648', weight_grams: '' }, { quantity: '1', weight_grams: '-1' },
    { quantity: '1', weight_grams: '0.0001' }, { quantity: '1', weight_grams: '1000000000' },
  ]) assert.throws(() => stockValues(fields));
  assert.equal(optionalInteger(''), null);
  assert.equal(optionalInteger('0'), 0);
  assert.equal(optionalInteger('2147483647'), 2147483647);
  for (const value of ['-1', '1.5', '2147483648']) assert.throws(() => optionalInteger(value));
});

test('Offline-Kopie speichert beide Listen, verwirft alte Versionen und wird beim Trennen entfernt', () => {
  saveConnection({ inventoryId: '11111111-1111-4111-8111-111111111111', deviceId: 'd', deviceToken: 't' });
  storage.set('eisfach.inventory', JSON.stringify({
    inventoryId: '11111111-1111-4111-8111-111111111111', items: [{ quantity: 3 }],
  }));
  assert.equal(loadSnapshot(), null);
  saveSnapshot([{ id: 'a' }], [{ item_id: 'a', quantity: 3 }]);
  assert.deepEqual(loadSnapshot().items, [{ id: 'a' }]);
  assert.deepEqual(loadSnapshot().stockEntries, [{ item_id: 'a', quantity: 3 }]);
  clearConnection();
  assert.equal(loadSnapshot(), null);
  assert.equal(storage.has('eisfach.inventory'), false);
});
