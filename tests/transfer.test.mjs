import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = { querySelector: () => null };
const { validateBackup, createBackup, importBackup } = await import('../js/transfer.js');
const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const tables = ['storage_locations', 'storage_compartments', 'items', 'stock_entries'];
const empty = () => Object.fromEntries(tables.map((table) => [table, []]));
const fixture = () => ({
  format: 'eisfach', version: 1, inventory_id: id(1),
  storage_locations: [{ id: id(2), name: 'Keller' }],
  storage_compartments: [{ id: id(3), location_id: id(2), name: 'Fach 1' }],
  items: [{
    id: id(4), name: 'Erbsen', product_number: '00123', weight_grams: '500.125',
    description: 'Fein', category: 'Gemüse', preparation_minutes: 0, thawing_minutes: null,
    qr_code: 'erbsen', notes: 'Dünsten',
  }],
  stock_entries: [{ id: id(5), item_id: id(4), location_id: id(2), compartment_id: id(3), quantity: 0 }],
});

test('Export enthält Produktdetails und Nullbestand, aber keine Bilder oder Zugangsdaten', () => {
  const data = fixture();
  data.deviceToken = 'not-exported';
  data.item_images = [{ path: 'private.webp' }];
  data.items[0].images = ['private.webp'];
  data.items[0].inventory_id = id(1);
  data.items[0].created_at = 'not-exported';
  const backup = createBackup(data, id(1));
  assert.equal(backup.items[0].product_number, '00123');
  assert.equal(backup.items[0].weight_grams, '500.125');
  assert.equal(backup.stock_entries[0].quantity, 0);
  assert.equal(backup.item_images, undefined);
  assert.equal(backup.items[0].images, undefined);
  assert.equal(backup.items[0].inventory_id, undefined);
  assert.equal(backup.deviceToken, undefined);
  assert.ok(backup.exported_at);
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(backup))), validateBackup(data));
});

test('Ungültige Werte, IDs, Versionen und Verweise werden vor dem Import abgewiesen', async () => {
  const cases = [
    (data) => { data.version = 2; },
    (data) => { delete data.items; },
    (data) => { data.items[0].id = 'bad-id'; },
    (data) => { data.items.push({ ...data.items[0] }); },
    (data) => { data.storage_locations.push({ id: id(6), name: 'Keller' }); },
    (data) => { data.items[0].product_number = 123; },
    (data) => { data.items[0].weight_grams = ''; },
    (data) => { data.items[0].weight_grams = -1; },
    (data) => { data.items[0].weight_grams = '1.0001'; },
    (data) => { data.items[0].preparation_minutes = 2147483648; },
    (data) => { data.stock_entries[0].quantity = 0.5; },
    (data) => { data.stock_entries[0].quantity = -1; },
    (data) => { data.stock_entries[0].item_id = id(9); },
    (data) => { data.storage_compartments[0].location_id = id(9); },
    (data) => {
      data.storage_locations.push({ id: id(9), name: 'Garage' });
      data.stock_entries[0].location_id = id(9);
    },
  ];
  for (const change of cases) {
    const data = fixture();
    change(data);
    let writes = 0;
    await assert.rejects(importBackup(data, id(1), empty(), async () => writes++), /Ungültige Exportdatei/);
    assert.equal(writes, 0);
  }
});

test('Neue Produktfelder bleiben beim Austausch erhalten; alte Sicherungen erhalten Defaults ohne Bestandszählung', async () => {
  const data = fixture();
  Object.assign(data.items[0], {
    product_url: 'https://example.org/erbsen', parts: '2 Beutel', favorite: false, usage_count: 7, rating: 0,
  });
  const backup = createBackup(data, id(1));
  const existing = empty();
  await importBackup(backup, id(10), existing, async (table, row) => existing[table].push(row));
  for (const key of ['product_url', 'parts', 'favorite', 'usage_count', 'rating']) {
    assert.equal(existing.items[0][key], data.items[0][key]);
  }
  assert.equal(existing.items[0].usage_count, 7);
  const old = fixture();
  old.items[0].notes = 'Teile: 02';
  const restored = validateBackup(old).items[0];
  assert.equal(restored.parts, '02');
  assert.equal(restored.usage_count, 0);
  assert.equal(restored.favorite, null);
  assert.equal(restored.rating, null);
  for (const fields of [{ rating: 6 }, { usage_count: -1 }, { product_url: 'javascript:alert(1)' },
    { favorite: 'true' }, { parts: 5 }]) {
    const invalid = fixture();
    Object.assign(invalid.items[0], fields);
    let writes = 0;
    await assert.rejects(importBackup(invalid, id(10), empty(), async () => writes++));
    assert.equal(writes, 0);
  }
});

test('Import in ein anderes Inventar ordnet alle Verweise zu und ist wiederholbar', async () => {
  const existing = empty();
  const writes = [];
  const insert = async (table, row) => {
    writes.push(table);
    existing[table].push(row);
  };
  assert.deepEqual(await importBackup(fixture(), id(10), existing, insert), { added: 4, skipped: 0 });
  assert.deepEqual(writes, tables);
  const [location] = existing.storage_locations;
  const [compartment] = existing.storage_compartments;
  const [product] = existing.items;
  const [stock] = existing.stock_entries;
  assert.notEqual(product.id, id(4));
  assert.equal(stock.inventory_id, id(10));
  assert.equal(stock.item_id, product.id);
  assert.equal(stock.location_id, location.id);
  assert.equal(stock.compartment_id, compartment.id);
  assert.equal(compartment.location_id, location.id);
  assert.equal(stock.quantity, 0);
  product.name = 'Vorhandene Änderung';
  assert.deepEqual(await importBackup(fixture(), id(10), existing, insert), { added: 0, skipped: 4 });
  assert.equal(product.name, 'Vorhandene Änderung');
  assert.equal(writes.length, 4);
});

test('Gleiche Orts- und Fachnamen werden wiederverwendet, gleiche Produktnamen nicht', async () => {
  const existing = empty();
  existing.storage_locations.push({ id: id(20), name: 'Keller' });
  existing.storage_compartments.push({ id: id(21), location_id: id(20), name: 'Fach 1' });
  existing.items.push({ ...fixture().items[0], id: id(22) });
  const result = await importBackup(fixture(), id(10), existing, async (table, row) => existing[table].push(row));
  assert.deepEqual(result, { added: 2, skipped: 2 });
  assert.equal(existing.items.length, 2);
  assert.equal(existing.stock_entries[0].location_id, id(20));
  assert.equal(existing.stock_entries[0].compartment_id, id(21));
});

test('Fehler meldet Teilimport; Wiederholung ergänzt nur fehlende Datensätze', async () => {
  const existing = empty();
  await assert.rejects(importBackup(fixture(), id(1), existing, async (table, row) => {
    if (table === 'items') throw new Error('Netzwerkfehler');
    existing[table].push(row);
  }), /2 ergänzt, 0 übersprungen.*Netzwerkfehler/);
  const result = await importBackup(fixture(), id(1), existing, async (table, row) => existing[table].push(row));
  assert.deepEqual(result, { added: 2, skipped: 2 });
  assert.equal(existing.items[0].id, id(4));
  assert.equal(existing.stock_entries[0].id, id(5));
});

test('Widersprüchliche Ortszuordnung stoppt vor dem Schreiben von Bestand', async () => {
  const existing = empty();
  existing.storage_locations.push({ id: id(2), name: 'Umbenannter Ort' });
  let writes = 0;
  await assert.rejects(importBackup(fixture(), id(1), existing, async () => writes++),
    /bereits importierter Ort oder ein Fach wurde verändert/);
  assert.equal(writes, 0);
});

test('Bestand ohne Fach und unbekanntes Packungsgewicht bleiben null', async () => {
  const data = fixture();
  data.items[0].weight_grams = null;
  data.stock_entries[0].compartment_id = null;
  const existing = empty();
  await importBackup(data, id(1), existing, async (table, row) => existing[table].push(row));
  assert.equal(existing.items[0].weight_grams, null);
  assert.equal(existing.stock_entries[0].compartment_id, null);
});
