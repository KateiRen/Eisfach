import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = { querySelector: () => null };
const { orderQuantity, reorderProduct, changeOrder, orderAmounts, orderAmountLabel,
  steppedOrderQuantity, receiveOrder } = await import('../js/orders.js');
const { saveConnection, clearConnection } = await import('../js/auth.js');
const { initProductEditor, editItem } = await import('../js/product-editor.js');
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

test('Mengenschritte speichern plus/minus eins und entfernen bei Minus von eins', () => {
  assert.equal(steppedOrderQuantity(2, 1), 3);
  assert.equal(steppedOrderQuantity(2, -1), 1);
  assert.equal(steppedOrderQuantity(1, -1), null);
  assert.equal(steppedOrderQuantity(2147483646, 1), 2147483647);
  for (const [quantity, step] of [[2147483647, 1], [0, 1], [2, 0], [2, 2]]) {
    assert.throws(() => steppedOrderQuantity(quantity, step));
  }
});

test('Einlagerung sendet Bestand und Bestellabzug als eine wiederholbare RPC und meldet Fehler', async (t) => {
  saveConnection({ inventoryId: '11111111-1111-4111-8111-111111111111', deviceId: 'd', deviceToken: 't' });
  t.after(clearConnection);
  const entry = { id: 'order', item_id: 'fish', quantity: 3, updated_at: '2026-11-16T22:00:00Z' };
  const position = { id: 'position', item_id: 'fish', location_id: 'cellar', compartment_id: null, quantity: 2 };
  let posts = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.ok(url.endsWith('/rest/v1/rpc/receive_order'));
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), {
      p_order_id: entry.id, p_item_id: 'fish', p_updated_at: entry.updated_at,
      p_id: 'position', p_location_id: 'cellar', p_compartment_id: null, p_quantity: 2,
    });
    posts++;
    if (posts === 1) throw new Error('Antwort verloren');
    if (posts === 3) return Response.json({ message: 'Bestelleintrag wurde zwischenzeitlich geändert.' }, { status: 400 });
    if (posts === 4) return Response.json([]);
    return Response.json([position]);
  });
  for (const invalid of [{ ...position, quantity: 0 }, { ...position, quantity: 4 },
    { ...position, item_id: 'other' }]) await assert.rejects(receiveOrder(entry, invalid));
  await assert.rejects(receiveOrder({ ...entry, updated_at: null }, position));
  assert.equal(posts, 0);
  await assert.rejects(receiveOrder(entry, position), /Antwort verloren/);
  assert.deepEqual(await receiveOrder(entry, position), position);
  await assert.rejects(receiveOrder(entry, position), /zwischenzeitlich geändert/);
  await assert.rejects(receiveOrder(entry, position), /nicht bestätigt/);
});

test('Positionspreise und Total rechnen centgenau mit gespeicherten Mengen, auch über dem sicheren Number-Bereich', () => {
  const result = orderAmounts([
    { price: '0.10', quantity: 3 },
    { price: 4.99, quantity: 2 },
    { price: 0, quantity: 5 },
  ]);
  assert.deepEqual(result, { amounts: [30n, 998n, 0n], total: 1028n });
  assert.equal(orderAmountLabel(result.total), '10,28\u00a0€');
  const large = orderAmounts([{ price: '99999999.99', quantity: 2147483647 }]);
  assert.equal(large.total, 21474836467852516353n);
  assert.equal(orderAmountLabel(large.total), '214.748.364.678.525.163,53\u00a0€');
  assert.deepEqual(orderAmounts([]), { amounts: [], total: 0n });
});

test('Fehlende Preise sind keine kostenlosen Produkte und verhindern ein unvollständiges Total', () => {
  const result = orderAmounts([
    { price: null, quantity: 2 }, { price: undefined, quantity: 1 },
    { price: '4.99', quantity: 3 }, { price: 0, quantity: 1 },
  ]);
  assert.deepEqual(result, { amounts: [null, null, 1497n, 0n], total: null });
  assert.equal(orderAmountLabel(result.total), '—');
  assert.equal(orderAmountLabel(0n), '0,00\u00a0€');
  assert.throws(() => orderAmounts([{ price: '1.999', quantity: 1 }]), /Preis/);
  assert.throws(() => orderAmounts([{ price: '1.99', quantity: 0 }]), /Bestellmenge/);
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

test('Gemeinsamer Produktdialog bearbeitet vollständige Daten und meldet Speichern an die aktuelle Seite', async (t) => {
  saveConnection({ inventoryId: '11111111-1111-4111-8111-111111111111', deviceId: 'd', deviceToken: 't' });
  t.after(clearConnection);
  const node = () => ({
    textContent: '', hidden: false, disabled: false, children: [], listeners: {},
    addEventListener(name, handler) { this.listeners[name] = handler; },
    replaceChildren(...children) { this.children = children; },
    querySelector() { return this.link; },
    removeAttribute() {},
  });
  const nodes = new Map(['main', '#item-dialog', '#item-form', '#cancel-item', '#delete-item',
    '#item-number-search', '#item-usage-count', '#editor-title', '#editor-status', '#editor-images']
    .map((key) => [key, node()]));
  const form = nodes.get('#item-form');
  form.elements = Object.fromEntries(['id', 'name', 'product_number', 'price', 'weight_grams', 'description',
    'category', 'notes', 'preparation_minutes', 'thawing_minutes', 'product_url', 'parts', 'favorite',
    'rating', 'images'].map((key) => [key, { ...node(), value: '', checked: false, files: [] }]));
  form.reset = () => {};
  const submit = node();
  form.querySelector = () => submit;
  const dialog = nodes.get('#item-dialog');
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; };
  const search = nodes.get('#item-number-search');
  search.link = node();
  nodes.get('main').insertAdjacentHTML = () => {};
  const previousDocument = globalThis.document;
  const previousFormData = globalThis.FormData;
  t.after(() => {
    globalThis.document = previousDocument;
    globalThis.FormData = previousFormData;
  });
  globalThis.document = {
    querySelector: (selector) => nodes.get(selector),
    querySelectorAll: () => [],
    createElement: node,
  };
  globalThis.FormData = class {
    *[Symbol.iterator]() {
      for (const [key, field] of Object.entries(form.elements)) yield [key, field.value];
    }
  };
  const item = {
    id: 'product', name: 'Fisch', product_number: '00123', price: 4.99, weight_grams: 500,
    category: 'Fisch', description: 'Beschreibung erhalten', notes: 'Notizen erhalten',
    preparation_minutes: 10, thawing_minutes: 90, product_url: 'https://example.org/fisch',
    parts: '2 Beutel', favorite: true, rating: 5, usage_count: 7, updated_at: 'version-1',
  };
  const saved = { ...item, price: 6.49, updated_at: 'version-2' };
  let patched;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method === 'PATCH') {
      assert.ok(url.includes('updated_at=eq.version-1'));
      patched = JSON.parse(options.body);
      return Response.json([saved]);
    }
    return Response.json([]);
  });
  let changed;
  initProductEditor({ isOffline: () => false, onChange: async (product) => { changed = product; } });
  await editItem(item);
  assert.equal(dialog.open, true);
  assert.equal(form.elements.description.value, item.description);
  assert.equal(form.elements.parts.value, item.parts);
  assert.equal(form.elements.favorite.checked, true);
  assert.equal(form.elements.rating.value, 5);
  assert.equal(nodes.get('#item-usage-count').textContent, '7');
  assert.equal(search.link.href, 'https://www.bofrost.de/search?text=00123&searchType=product');
  for (const field of Object.values(form.elements)) field.value = String(field.value);
  form.elements.price.value = '6,49';
  await form.listeners.submit({ preventDefault() {} });
  assert.equal(patched.price, 6.49);
  assert.equal(patched.description, item.description);
  assert.equal(patched.notes, item.notes);
  assert.equal(patched.parts, item.parts);
  assert.equal(patched.product_url, item.product_url);
  assert.equal(patched.usage_count, undefined);
  assert.deepEqual(changed, saved);
  assert.equal(dialog.open, false);
});
