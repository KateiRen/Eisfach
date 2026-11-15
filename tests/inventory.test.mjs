import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = { querySelector: () => null };
const {
  hasStock, matchesProduct, optionalInteger, optionalWeight, stockValues, groupCatalog, productPackInfo,
  productWeightLabel, filterByProductNumber,
  productStockLabel, loadProductImages, loadStockPreview,
} = await import('../js/inventory.js');
const { saveConnection, clearConnection, saveSnapshot, loadSnapshot } = await import('../js/auth.js');
const { locationSelection, locationLabel } = await import('../js/locations.js');

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};

test('Nur eine positive Stückzahl ergibt Bestand; alte Gewichte ändern dies nicht', () => {
  assert.equal(hasStock({ quantity: 0, weight_grams: null }), false);
  assert.equal(hasStock({ quantity: 0, weight_grams: '0.000' }), false);
  assert.equal(hasStock({ quantity: 1, weight_grams: null }), true);
  assert.equal(hasStock({ quantity: 0, weight_grams: '0.001' }), false);
});

test('Kategorie-Einzelauswahl zeigt die gewählte Kategorie und ohne Auswahl alle Produkte', () => {
  const products = [
    { name: 'Lachs', category: 'Fisch' },
    { name: 'Erbsen', category: 'Gemüse' },
    { name: 'Waffeln', category: 'Dessert' },
    { name: 'Brot', category: '' },
  ];
  const names = (category) => products
    .filter((item) => matchesProduct(item, '', category)).map((item) => item.name);
  assert.deepEqual(names('Fisch'), ['Lachs']);
  assert.deepEqual(names('Gemüse'), ['Erbsen']);
  assert.deepEqual(names(''), ['Lachs', 'Erbsen', 'Waffeln', 'Brot']);
});

test('Kategorie-Buttons bleiben mit Suche nach Produkt und Lagerort kombinierbar', () => {
  const product = { name: 'Lachs', category: 'Fisch', notes: 'Für Gäste' };
  assert.equal(matchesProduct(product, 'LACHS', 'Fisch'), true);
  assert.equal(matchesProduct(product, 'GÄSTE', 'Fisch'), true);
  assert.equal(matchesProduct(product, 'KELLER', 'Fisch', ['Keller · Fach 1']), true);
  assert.equal(matchesProduct(product, 'Keller', 'Gemüse', ['Keller']), false);
  assert.equal(matchesProduct(product, 'Erbsen', 'Fisch'), false);
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

test('Bestand gruppiert Positionen nach Produktkategorie und erhält mehrere Orte pro Produkt', () => {
  const products = new Map([
    ['z', { name: 'Zander', category: 'Fisch' }],
    ['l', { name: 'Lachs', category: 'Fisch' }],
    ['a', { name: 'Apfel', category: 'Obst' }],
    ['n', { name: 'Ohne', category: '' }],
  ]);
  const entries = [
    { id: '1', item_id: 'a', location_id: 'cellar' },
    { id: '2', item_id: 'z', location_id: 'cellar' },
    { id: '3', item_id: 'l', location_id: 'kitchen' },
    { id: '4', item_id: 'l', location_id: 'cellar' },
    { id: '5', item_id: 'n', location_id: 'cellar' },
  ];
  assert.deepEqual(groupCatalog(entries, (entry) => products.get(entry.item_id)).map((group) => ({
    category: group.category, ids: group.items.map((entry) => entry.id),
  })), [
    { category: 'Fisch', ids: ['3', '4', '2'] },
    { category: 'Obst', ids: ['1'] },
    { category: '', ids: ['5'] },
  ]);
});

test('Packungsgewicht stammt aus dem Produktfeld und Teile bleiben als Notiztext erhalten', () => {
  assert.deepEqual(productPackInfo({ notes: 'Gewicht: 1,25 kg\nTeile: 6-8', weight_grams: '500.125' }),
    { parts: '6-8', weight: '500,125 g' });
  assert.deepEqual(productPackInfo({ notes: 'Gewicht:\r\nTeile: 02\r\nHinweis: Gewicht: 500 g' }),
    { parts: '02', weight: '—' });
  assert.deepEqual(productPackInfo({ notes: 'Vorbereitung: Teile: 6' }), { parts: '—', weight: '—' });
  assert.deepEqual(productPackInfo(), { parts: '—', weight: '—' });
  assert.equal(productWeightLabel({ weight_grams: 0 }), '0 g');
  assert.equal(productWeightLabel(undefined), '—');
});

test('Produktnummernfilter erhält führende Nullen und sucht Teiltreffer nur im eigenen Feld', () => {
  const products = [
    { id: 'a', product_number: '00123' },
    { id: 'b', product_number: 'AB-123' },
    { id: 'c', product_number: '', notes: 'Nr: 00123' },
  ];
  assert.deepEqual(filterByProductNumber(products, '001').map((item) => item.id), ['a']);
  assert.deepEqual(filterByProductNumber(products, '123').map((item) => item.id), ['a', 'b']);
  assert.deepEqual(filterByProductNumber(products, ' ab- ').map((item) => item.id), ['b']);
  assert.deepEqual(filterByProductNumber(products, ' '), products);
  assert.deepEqual(filterByProductNumber(products, '999'), []);
  assert.equal(matchesProduct({ name: 'Fisch', product_number: '00123' }, '00123', ''), true);
});

test('Katalogbestand summiert Stückzahlen über Orte und ignoriert alte Gewichte ohne Stückzahl', () => {
  const entries = [
    { item_id: 'fish', quantity: 2, weight_grams: 500 },
    { item_id: 'fish', quantity: 3, weight_grams: null },
    { item_id: 'fish', quantity: 0, weight_grams: null },
    { item_id: 'fruit', quantity: 0, weight_grams: 250 },
  ];
  assert.equal(productStockLabel('fish', entries), 'Bestand: 5 Stück · 2 Positionen');
  assert.equal(productStockLabel('fruit', entries), 'Kein Bestand');
  assert.equal(productStockLabel('empty', entries), 'Kein Bestand');
  assert.equal(productStockLabel('fish', [{ item_id: 'fish', quantity: 0, weight_grams: 0 }]), 'Kein Bestand');
});

test('Produktbilder werden signiert angezeigt; veraltete Dialog-Ladevorgänge ändern keine Bilder', async (t) => {
  saveConnection({ inventoryId: '11111111-1111-4111-8111-111111111111', deviceId: 'test', deviceToken: 'test' });
  const previousDocument = globalThis.document;
  const node = (tag) => ({
    tag, children: [],
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener() {},
  });
  globalThis.document = { querySelector: () => null, createElement: node };
  t.after(() => { globalThis.document = previousDocument; clearConnection(); });
  let current = true;
  let invalidateOnSign = false;
  t.mock.method(globalThis, 'fetch', async (url) => {
    let response;
    if (url.includes('/functions/v1/imageStorage')) {
      if (invalidateOnSign) current = false;
      response = { signedURL: 'https://example.invalid/signed-product.webp' };
    } else {
      response = new URL(url).searchParams.get('offset') === '0'
        ? [{ id: 'image', path: 'test/product.webp', caption: 'Packung' }] : [];
    }
    return new Response(JSON.stringify(response), { status: 200 });
  });
  const gallery = node('div');
  gallery.id = 'editor-images';
  await loadProductImages({ id: 'product', name: 'Fisch' }, gallery, () => current);
  assert.equal(gallery.children.length, 1);
  const [image, caption, remove] = gallery.children[0].children;
  assert.equal(image.src, 'https://example.invalid/signed-product.webp');
  assert.equal(image.alt, 'Packung');
  assert.equal(caption.textContent, 'Packung');
  assert.equal(remove.textContent, 'Bild löschen');
  current = false;
  await loadProductImages({ id: 'old-product' }, gallery, () => current);
  assert.equal(gallery.children.length, 1);
  current = true;
  invalidateOnSign = true;
  await loadProductImages({ id: 'product' }, gallery, () => current);
  assert.equal(gallery.children.length, 0);
});

test('Bestandsvorschau zeigt nur das erste Bild, teilt Anfragen und meldet Ladefehler', async (t) => {
  saveConnection({ inventoryId: '11111111-1111-4111-8111-111111111111', deviceId: 'test', deviceToken: 'test' });
  const previousDocument = globalThis.document;
  const node = () => ({
    children: [], textContent: '',
    replaceChildren(...children) { this.children = children; },
    addEventListener() {},
  });
  globalThis.document = { querySelector: () => null, createElement: node };
  t.after(() => { globalThis.document = previousDocument; clearConnection(); });
  let metadataCalls = 0;
  const signedPaths = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    let response;
    if (url.includes('/functions/v1/imageStorage')) {
      const { path } = JSON.parse(options.body);
      signedPaths.push(path);
      if (path === 'broken.webp') throw new Error('Testfehler');
      response = { signedURL: `https://example.invalid/${path}` };
    } else {
      metadataCalls++;
      response = new URL(url).searchParams.get('offset') === '0' ? [
        { item_id: 'fish', path: 'first.webp' },
        { item_id: 'fish', path: 'second.webp' },
        { item_id: 'broken', path: 'broken.webp' },
      ] : [];
    }
    return new Response(JSON.stringify(response), { status: 200 });
  });
  const first = node();
  const second = node();
  await Promise.all([
    loadStockPreview({ id: 'fish', name: 'Fisch' }, first, () => true),
    loadStockPreview({ id: 'fish', name: 'Fisch' }, second, () => true),
  ]);
  assert.equal(first.children.length, 1);
  assert.equal(first.children[0].src, 'https://example.invalid/first.webp');
  assert.equal(first.children[0].alt, 'Fisch');
  assert.equal(second.children.length, 1);
  assert.deepEqual(signedPaths, ['first.webp']);
  assert.equal(metadataCalls, 2);
  const missing = node();
  await loadStockPreview({ id: 'missing' }, missing, () => true);
  assert.equal(missing.textContent, 'Kein Bild');
  const broken = node();
  await loadStockPreview({ id: 'broken' }, broken, () => true);
  assert.match(broken.textContent, /Bild nicht verfügbar: Testfehler/);
  const stale = node();
  stale.textContent = 'Neuer Inhalt';
  await loadStockPreview({ id: 'fish' }, stale, () => false);
  assert.equal(stale.textContent, 'Neuer Inhalt');
});

test('Stückzahl, Produktgewicht und Zeiten beachten Grenzen und optionale Werte', () => {
  assert.deepEqual(stockValues({ quantity: '0' }), { quantity: 0 });
  assert.deepEqual(stockValues({ quantity: '2147483647' }), { quantity: 2147483647 });
  assert.deepEqual(stockValues({ quantity: '1', weight_grams: '500' }), { quantity: 1 });
  for (const quantity of ['', '-1', '1.5', '2147483648']) assert.throws(() => stockValues({ quantity }));
  assert.equal(optionalWeight(''), null);
  assert.equal(optionalWeight('0'), 0);
  assert.equal(optionalWeight('500.125'), 500.125);
  assert.equal(optionalWeight('999999999.999'), 999999999.999);
  for (const value of ['-1', '0.0001', '1000000000', 'NaN', '1e3']) assert.throws(() => optionalWeight(value));
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
    version: 3, inventoryId: '11111111-1111-4111-8111-111111111111',
    items: [{ id: 'a' }], stockEntries: [{ item_id: 'a', location_id: 'cellar', weight_grams: 500 }],
    locations: [], compartments: [],
  }));
  assert.equal(loadSnapshot(), null);
  const locations = [{ id: 'cellar', name: 'Keller' }];
  const compartments = [{ id: 'c1', location_id: 'cellar', name: 'Fach 1' }];
  const products = [{ id: 'a', product_number: '00123', weight_grams: '500.125' }];
  saveSnapshot(products, [{ item_id: 'a', quantity: 3 }], locations, compartments);
  assert.deepEqual(loadSnapshot().items, products);
  assert.deepEqual(loadSnapshot().stockEntries, [{ item_id: 'a', quantity: 3 }]);
  assert.deepEqual(loadSnapshot().locations, locations);
  assert.deepEqual(loadSnapshot().compartments, compartments);
  clearConnection();
  assert.equal(loadSnapshot(), null);
  assert.equal(storage.has('eisfach.inventory'), false);
});
