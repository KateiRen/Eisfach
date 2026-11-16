import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = { querySelector: () => null };
const { bulkDraft, bulkChanges, bulkRowChanged, loadBulkPage, saveBulkRows } = await import('../js/bulk-edit.js');
const { saveConnection, clearConnection } = await import('../js/auth.js');
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};
const item = (id = 'product') => ({
  id, name: 'Erbsen', product_number: '00123', weight_grams: '500.125', parts: '2 Beutel',
  description: 'Fein', preparation_minutes: 0, thawing_minutes: null, notes: 'Dünsten',
  usage_count: 7, rating: 5, updated_at: '2026-01-01T10:00:00Z',
});
const row = (id) => {
  const source = item(id);
  return { item: source, draft: bulkDraft(source), invalidFields: new Set(), feedback: '', error: false };
};
function connect(t) {
  saveConnection({ inventoryId: '11111111-1111-4111-8111-111111111111', deviceId: 'test', deviceToken: 'test' });
  t.after(clearConnection);
}

test('Bulk-Änderungen enthalten nur bearbeitete erlaubte Felder und unterscheiden null, 0 und Text', () => {
  const source = item();
  const draft = bulkDraft(source);
  assert.deepEqual(bulkChanges(source, draft), {});
  assert.deepEqual(bulkChanges(source, {
    ...draft, weight_grams: '', parts: '  ', description: ' Neu ',
    preparation_minutes: '', thawing_minutes: '0', notes: '',
    usage_count: '0', name: 'Nicht ändern', rating: '0',
  }), {
    weight_grams: null, parts: null, description: 'Neu',
    preparation_minutes: null, thawing_minutes: 0, notes: '',
  });
  assert.deepEqual(bulkChanges({ ...source, weight_grams: '500.000' }, {
    ...draft, weight_grams: '500', notes: ' Dünsten ',
  }), {});
  for (const fields of [
    { weight_grams: '-1' }, { weight_grams: '0.0001' }, { weight_grams: '1000000000' },
    { preparation_minutes: '1.5' }, { thawing_minutes: '2147483648' },
    { description: 'x'.repeat(2001) }, { notes: 'x'.repeat(4001) },
  ]) assert.throws(() => bulkChanges(source, { ...draft, ...fields }));
});

test('Bulk-Seiten laden höchstens 20 sichtbare Artikel mit stabiler Sortierung und erkennen die letzte Seite', async (t) => {
  connect(t);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const query = new URL(url).searchParams;
    requests.push(query);
    const counts = { 0: 21, 20: 2, 40: 20, 60: 0 };
    return Response.json(Array.from({ length: counts[query.get('offset')] }, (_, index) => item(String(index))));
  });
  const first = await loadBulkPage(0);
  assert.equal(first.items.length, 20);
  assert.equal(first.hasNext, true);
  assert.equal(first.items.at(-1).id, '19');
  const last = await loadBulkPage(1);
  assert.equal(last.items.length, 2);
  assert.equal(last.hasNext, false);
  const exact = await loadBulkPage(2);
  assert.equal(exact.items.length, 20);
  assert.equal(exact.hasNext, false);
  assert.deepEqual(await loadBulkPage(3), { items: [], hasNext: false });
  assert.equal(requests[0].get('limit'), '21');
  assert.equal(requests[1].get('offset'), '20');
  assert.equal(requests[0].get('order'), 'name.asc,id.asc');
  assert.equal(requests[0].get('select').includes('item_images'), false);
});

test('Teilfehler erhalten Eingaben; erfolgreiche und unveränderte Artikel werden beim Retry nicht erneut geschrieben', async () => {
  const records = [row('one'), row('two'), row('three'), row('unchanged')];
  records[0].draft.notes = 'Neu';
  records[1].draft.parts = '3 Beutel';
  records[2].draft.weight_grams = '-1';
  let fail = true;
  const writes = [];
  const save = async (source, changes) => {
    writes.push(source.id);
    if (source.id === 'two' && fail) throw new Error('Testfehler');
    return { ...source, ...changes, updated_at: '2026-01-02T10:00:00Z' };
  };
  assert.deepEqual(await saveBulkRows(records, save), { saved: 1, failed: 2 });
  assert.equal(bulkRowChanged(records[0]), false);
  assert.equal(records[0].item.notes, 'Neu');
  assert.equal(records[1].draft.parts, '3 Beutel');
  assert.equal(records[1].item.parts, '2 Beutel');
  assert.equal(records[1].feedback, 'Testfehler');
  assert.equal(records[2].draft.weight_grams, '-1');
  assert.deepEqual(writes, ['one', 'two']);
  fail = false;
  records[2].draft.weight_grams = '20';
  assert.deepEqual(await saveBulkRows(records, save), { saved: 2, failed: 0 });
  assert.deepEqual(writes, ['one', 'two', 'two', 'three']);
  assert.ok(records.every((record) => !bulkRowChanged(record)));
  assert.equal(records[0].item.usage_count, 7);
});

test('Bulk-Speicherung schützt Änderungsstände, meldet Konflikte je Zeile und nutzt nach Erfolg die neue Version', async (t) => {
  connect(t);
  const record = row('11111111-1111-4111-8111-111111111111');
  record.draft.description = 'Neu';
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const query = new URL(url).searchParams;
    assert.equal(options.method, 'PATCH');
    assert.equal(query.get('id'), `eq.${record.item.id}`);
    assert.equal(query.get('updated_at'), `eq.${record.item.updated_at}`);
    assert.equal(options.headers.Prefer, 'return=representation');
    const body = JSON.parse(options.body);
    assert.deepEqual(body, calls === 2 ? { description: 'Noch neuer' } : { description: 'Neu' });
    calls++;
    return Response.json(calls === 1 ? [] : [{
      ...record.item, ...body, updated_at: `2026-01-0${calls}T10:00:00Z`,
    }]);
  });
  assert.deepEqual(await saveBulkRows([record]), { saved: 0, failed: 1 });
  assert.match(record.feedback, /zwischenzeitlich geändert/);
  assert.equal(record.draft.description, 'Neu');
  assert.deepEqual(await saveBulkRows([record]), { saved: 1, failed: 0 });
  assert.equal(record.item.updated_at, '2026-01-02T10:00:00Z');
  record.draft.description = 'Noch neuer';
  assert.deepEqual(await saveBulkRows([record]), { saved: 1, failed: 0 });
  assert.equal(calls, 3);
});

test('Ungültige Zahleneingaben werden nicht versehentlich als leere Werte gespeichert', async () => {
  const record = row('product');
  record.draft.thawing_minutes = '';
  record.invalidFields.add('thawing_minutes');
  let writes = 0;
  assert.equal(bulkRowChanged(record), true);
  assert.deepEqual(await saveBulkRows([record], async () => { writes++; }), { saved: 0, failed: 1 });
  assert.equal(writes, 0);
  assert.equal(record.invalidFields.has('thawing_minutes'), true);
  assert.match(record.feedback, /gültige Zahlen/);
});

test('Fehlende Änderungsstände verhindern blinde Updates; Ladefehler bleiben ausdrücklich Fehler', async (t) => {
  connect(t);
  const record = row('product');
  record.item.updated_at = null;
  record.draft.parts = '3';
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({ message: 'Nicht verfügbar' }, { status: 503 });
  });
  assert.deepEqual(await saveBulkRows([record]), { saved: 0, failed: 1 });
  assert.match(record.feedback, /Änderungsstand fehlt/);
  assert.equal(calls, 0);
  await assert.rejects(loadBulkPage(0), /Nicht verfügbar/);
});
