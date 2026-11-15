import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = { querySelector: () => null };
const { hasStock, optionalInteger, stockValues, groupCatalog, productPackInfo, productStockLabel } = await import('../js/inventory.js');
const { saveConnection, clearConnection, saveSnapshot, loadSnapshot } = await import('../js/auth.js');
const { locationSelection, locationLabel } = await import('../js/locations.js');

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

test('Katalog gruppiert Kategorien und sortiert Produkte darin deutsch alphabetisch', () => {
  const products = [
    { name: 'Zander', category: 'Fisch' },
    { name: 'Waffeln', category: '' },
    { name: 'Zwiebelringe', category: 'Beilage' },
    { name: 'Lachs', category: 'Fisch' },
    { name: 'Äpfel', category: 'Beilage' },
    { name: 'Apfelkuchen', category: '' },
  ];
  const original = [...products];
  assert.deepEqual(groupCatalog(products).map((group) => ({
    category: group.category, names: group.items.map((item) => item.name),
  })), [
    { category: 'Beilage', names: ['Äpfel', 'Zwiebelringe'] },
    { category: 'Fisch', names: ['Lachs', 'Zander'] },
    { category: '', names: ['Apfelkuchen', 'Waffeln'] },
  ]);
  assert.deepEqual(products, original);
});

test('Katalog bildet bei gefilterten und leeren Ergebnissen keine leeren Gruppen', () => {
  const products = [{ name: 'Zander', category: 'Fisch' }, { name: 'Lachs', category: 'Fisch' }];
  assert.deepEqual(groupCatalog(products.filter((item) => item.name === 'Lachs')),
    [{ category: 'Fisch', items: [products[1]] }]);
  assert.deepEqual(groupCatalog([]), []);
});

test('Katalog zeigt nur Packungsangaben aus eigenen Notizzeilen ohne Zahlenumwandlung', () => {
  assert.deepEqual(productPackInfo('Nr: 00123\nGewicht: 1,25 kg\nTeile: 6-8\nPreis: 9,99'),
    { parts: '6-8', weight: '1,25 kg' });
  assert.deepEqual(productPackInfo('Gewicht:\r\nTeile: 02\r\nHinweis: Gewicht: 500 g'),
    { parts: '02', weight: '—' });
  assert.deepEqual(productPackInfo('Vorbereitung: Gewicht: 500 g'), { parts: '—', weight: '—' });
  assert.deepEqual(productPackInfo(), { parts: '—', weight: '—' });
});

test('Katalogbestand summiert Stückzahlen über Orte und berücksichtigt reinen Gewichtsbestand', () => {
  const entries = [
    { item_id: 'fish', quantity: 2, weight_grams: 500 },
    { item_id: 'fish', quantity: 3, weight_grams: null },
    { item_id: 'fish', quantity: 0, weight_grams: null },
    { item_id: 'fruit', quantity: 0, weight_grams: 250 },
  ];
  assert.equal(productStockLabel('fish', entries), 'Bestand: 5 Stück · 2 Positionen');
  assert.equal(productStockLabel('fruit', entries), 'Bestand: 1 Position');
  assert.equal(productStockLabel('empty', entries), 'Kein Bestand');
  assert.equal(productStockLabel('fish', [{ item_id: 'fish', quantity: 0, weight_grams: 0 }]), 'Kein Bestand');
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

test('Orte erlauben kein, ein zugehöriges, aber kein fremdes Fach', () => {
  const locations = [{ id: 'kitchen', name: 'Kühlschrank' }, { id: 'cellar', name: 'Keller' }];
  const compartments = [{ id: 'k1', location_id: 'kitchen', name: 'Fach 1' },
    { id: 'c1', location_id: 'cellar', name: 'Fach 1' }];
  assert.deepEqual(locationSelection({ location_id: 'kitchen', compartment_id: '' }, locations, compartments),
    { location_id: 'kitchen', compartment_id: null });
  const selected = locationSelection({ location_id: 'cellar', compartment_id: 'c1' }, locations, compartments);
  assert.equal(locationLabel(selected, locations, compartments), 'Keller · Fach 1');
  assert.equal(locationLabel({ location_id: 'kitchen', compartment_id: null }, locations, compartments), 'Kühlschrank');
  for (const fields of [
    { location_id: '', compartment_id: '' },
    { location_id: 'free text', compartment_id: '' },
    { location_id: 'kitchen', compartment_id: 'c1' },
    { location_id: 'kitchen', compartment_id: 'deleted' },
  ]) assert.throws(() => locationSelection(fields, locations, compartments));
});

test('Offline-Kopie speichert Produkte, Bestand und Ortsnamen und verwirft alte Versionen', () => {
  saveConnection({ inventoryId: '11111111-1111-4111-8111-111111111111', deviceId: 'd', deviceToken: 't' });
  storage.set('eisfach.inventory', JSON.stringify({
    version: 2, inventoryId: '11111111-1111-4111-8111-111111111111',
    items: [{ id: 'a' }], stockEntries: [{ location: 'Legacy free text' }],
  }));
  assert.equal(loadSnapshot(), null);
  const locations = [{ id: 'cellar', name: 'Keller' }];
  const compartments = [{ id: 'c1', location_id: 'cellar', name: 'Fach 1' }];
  saveSnapshot([{ id: 'a' }], [{ item_id: 'a', quantity: 3 }], locations, compartments);
  assert.deepEqual(loadSnapshot().items, [{ id: 'a' }]);
  assert.deepEqual(loadSnapshot().stockEntries, [{ item_id: 'a', quantity: 3 }]);
  assert.deepEqual(loadSnapshot().locations, locations);
  assert.deepEqual(loadSnapshot().compartments, compartments);
  clearConnection();
  assert.equal(loadSnapshot(), null);
  assert.equal(storage.has('eisfach.inventory'), false);
});
