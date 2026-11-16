import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createZip, readZip, MAX_ZIP_SIZE } from '../js/zip.js';
import { restoreImage, validateWebP } from '../js/storage.js';
import { saveConnection, clearConnection } from '../js/auth.js';

globalThis.document = { querySelector: () => null };
const { createImageArchive, readImageArchive, importArchiveImages, validateImageArchive } = await import('../js/transfer.js');
const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const encoder = new TextEncoder();
const fixture = () => ({
  format: 'eisfach', version: 1, inventory_id: id(1),
  storage_locations: [], storage_compartments: [], stock_entries: [],
  items: [{
    id: id(2), name: 'Erbsen', product_number: '001', weight_grams: null,
    description: '', category: '', preparation_minutes: null, thawing_minutes: null, qr_code: null, notes: '',
  }],
});
// Structural WebP fixture; rendering is exercised with a real WebP in the browser.
function webp() {
  const bytes = new Uint8Array(24);
  bytes.set(encoder.encode('RIFF'), 0);
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  bytes.set(encoder.encode('WEBPVP8 '), 8);
  return bytes;
}
const image = () => ({
  id: id(3), item_id: id(2), caption: 'Erbsen à la maison', sort_order: 2,
  path: `${id(1)}/${id(2)}/${id(4)}.webp`,
});

test('ZIP sichert unveränderte Bytes und Unicode-Inhalte und erkennt Beschädigungen', async () => {
  const entries = new Map([['inventory.json', encoder.encode('{"name":"Äpfel"}')],
    [`images/${id(3)}.webp`, webp()]]);
  const bytes = new Uint8Array(await createZip(entries).arrayBuffer());
  const read = readZip(bytes);
  assert.deepEqual(read, entries);
  const damaged = bytes.slice();
  damaged[30 + 'inventory.json'.length] ^= 1;
  assert.throws(() => readZip(damaged), /Prüfsumme/);
  assert.throws(() => readZip(bytes.subarray(0, bytes.length - 1)), /ZIP/);
  assert.throws(() => createZip(new Map([['../private', webp()]])), /Dateiname/);
  assert.throws(() => readZip(new Uint8Array(MAX_ZIP_SIZE + 1)), /Größe/);
  const compressed = bytes.slice();
  const start = new DataView(compressed.buffer).getUint32(compressed.length - 6, true);
  new DataView(compressed.buffer).setUint16(start + 10, 8, true);
  assert.throws(() => readZip(compressed), /Neukomprimierung/);
});

test('Größenlimits akzeptieren exakt 100 MB ZIP und 5 MB WebP, aber kein Byte mehr', () => {
  const overhead = 30 + 46 + 22 + 2 * encoder.encode('inventory.json').length;
  const content = new Uint8Array(MAX_ZIP_SIZE - overhead + 1);
  assert.equal(createZip(new Map([['inventory.json', content.subarray(0, -1)]])).size, MAX_ZIP_SIZE);
  assert.throws(() => createZip(new Map([['inventory.json', content]])), /100 MB/);
  const image = new Uint8Array(5 * 1024 * 1024 + 1);
  image.set(webp());
  new DataView(image.buffer).setUint32(4, image.length - 1 - 8, true);
  assert.doesNotThrow(() => validateWebP(image.subarray(0, -1)));
  assert.throws(() => validateWebP(image), /5 MB/);
});

test('ZIP exportiert alle Bilder mit Metadaten und bricht bei Downloadfehler ab', async () => {
  const progress = [];
  const data = fixture();
  const details = { product_url: 'https://example.org/erbsen', parts: '2 Beutel', favorite: false, rating: 0, usage_count: 7 };
  Object.assign(data.items[0], details);
  const blob = await createImageArchive(data, [image()], async (path) => {
    assert.equal(path, image().path);
    return webp();
  }, (...counts) => progress.push(counts));
  const archive = readImageArchive(new Uint8Array(await blob.arrayBuffer()));
  for (const [key, value] of Object.entries(details)) assert.equal(archive.data.items[0][key], value);
  assert.equal(archive.images[0].caption, image().caption);
  assert.equal(archive.images[0].sort_order, 2);
  assert.deepEqual(archive.files.get(`images/${id(3)}.webp`), webp());
  assert.deepEqual(progress, [[1, 1]]);
  await assert.rejects(createImageArchive(fixture(), [image()], async () => {
    throw new Error('Downloadfehler');
  }), /Downloadfehler/);
  await assert.rejects(createImageArchive(fixture(), [image()], async () => new Uint8Array(20)), /WebP/);
  await assert.rejects(createImageArchive(fixture(), Array(2000).fill(image()), async () => webp()), /1999/);
});

test('Bildmanifest verweist nur auf enthaltene Produkte und exakt enthaltene Bilddateien', async () => {
  const blob = await createImageArchive(fixture(), [image()], async () => webp());
  const original = readZip(new Uint8Array(await blob.arrayBuffer()));
  for (const mutate of [
    (manifest) => { manifest.images[0].item_id = id(99); },
    (manifest) => { manifest.images.push(manifest.images[0]); },
    (manifest) => { manifest.images[0].sort_order = 1.5; },
    (manifest) => { manifest.images[0].id = id(99); },
  ]) {
    const entries = new Map(original);
    const manifest = JSON.parse(new TextDecoder().decode(entries.get('inventory.json')));
    mutate(manifest);
    entries.set('inventory.json', encoder.encode(JSON.stringify(manifest)));
    const invalid = new Uint8Array(await createZip(entries).arrayBuffer());
    assert.throws(() => readImageArchive(invalid), /Ungültige|WebP/);
  }
  const entries = new Map(original);
  entries.set(`images/${id(99)}.webp`, webp());
  assert.throws(() => validateImageArchive(
    JSON.parse(new TextDecoder().decode(entries.get('inventory.json'))), entries), /Unerwartete/);
});

test('Bildimport ordnet Zielprodukt und Dateipfad stabil zu; Wiederholung überspringt Bilder', async () => {
  const blob = await createImageArchive(fixture(), [image()], async () => webp());
  const archive = readImageArchive(new Uint8Array(await blob.arrayBuffer()));
  const existing = [];
  let calls = 0;
  const upload = async (record, bytes, fileId) => {
    calls++;
    assert.equal(record.caption, image().caption);
    assert.equal(record.sort_order, 2);
    assert.notEqual(record.item_id, id(2));
    assert.deepEqual(bytes, webp());
    existing.push({ ...record, path: `${record.inventory_id}/${record.item_id}/${fileId}.webp` });
  };
  assert.deepEqual(await importArchiveImages(archive, id(10), existing, upload), { added: 1, skipped: 0 });
  assert.deepEqual(await importArchiveImages(archive, id(10), existing, upload), { added: 0, skipped: 1 });
  assert.equal(calls, 1);
  await assert.rejects(importArchiveImages(archive, id(10), [], async () => {
    throw new Error('Uploadfehler');
  }), /0 Bilder ergänzt.*Uploadfehler/);
});

test('Import desselben Inventars erkennt originale Bilder und widersprüchliche IDs', async () => {
  const blob = await createImageArchive(fixture(), [image()], async () => webp());
  const archive = readImageArchive(new Uint8Array(await blob.arrayBuffer()));
  const unexpected = async () => assert.fail('Kein Upload erwartet');
  assert.deepEqual(await importArchiveImages(archive, id(1), [image()], unexpected), { added: 0, skipped: 1 });
  await assert.rejects(importArchiveImages(archive, id(1), [{ ...image(), item_id: id(99) }], unexpected),
    /abweichende Zuordnung/);
});

test('Bild-Upload nach Metadatenfehler nutzt vorhandene unveränderte Datei ohne Neukomprimierung', async (t) => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  saveConnection({ inventoryId: id(1), deviceId: 'test', deviceToken: 'test' });
  t.after(clearConnection);
  let object = null;
  let failMetadata = true;
  let metadata = null;
  const record = { id: id(3), item_id: id(2), inventory_id: id(1), caption: image().caption, sort_order: 2 };
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (String(url).includes('/functions/v1/imageStorage')) {
      if (options.body instanceof Blob) {
        assert.equal(options.headers['x-file-id'], id(4));
        const bytes = new Uint8Array(await options.body.arrayBuffer());
        assert.deepEqual(bytes, webp());
        if (object) return new Response('{"message":"Image already exists"}', { status: 409 });
        object = bytes;
        return Response.json({ path: image().path });
      }
      return Response.json({ signedURL: 'https://example.invalid/image.webp' });
    }
    if (String(url) === 'https://example.invalid/image.webp') return new Response(object);
    if (failMetadata) {
      failMetadata = false;
      return new Response('{"message":"Metadata failure"}', { status: 503 });
    }
    metadata = JSON.parse(options.body);
    return new Response(null, { status: 204 });
  });
  await assert.rejects(restoreImage(record, webp(), id(4)), /Metadata failure/);
  assert.equal(await restoreImage(record, webp(), id(4)), image().path);
  assert.deepEqual(metadata, { id: id(3), item_id: id(2), path: image().path, caption: image().caption, sort_order: 2 });
  object[23] = 1;
  await assert.rejects(restoreImage(record, webp(), id(4)), /abweichenden Inhalt/);
});
