import { rest } from './supabase.js';
import { element, status } from './app.js';
import { optionalInteger, optionalWeight, productURL } from './product.js';

const PAGE_SIZE = 10;
const FIELDS = [
  { name: 'weight_grams', label: 'Gewicht pro Packung', type: 'number', max: '999999999.999', step: '0.001' },
  { name: 'parts', label: 'Teile', type: 'text' },
  { name: 'description', label: 'Beschreibung', type: 'textarea', maxLength: 2000 },
  { name: 'preparation_minutes', label: 'Zubereitungszeit', type: 'number', max: '2147483647', step: '1' },
  { name: 'thawing_minutes', label: 'Auftauzeit', type: 'number', max: '2147483647', step: '1' },
  { name: 'notes', label: 'Notizen', type: 'textarea', maxLength: 4000 },
  { name: 'product_url', label: 'Produktseite (URL)', type: 'url' },
];
let rows = [];
let page = 0;
let hasNext = false;
let loaded = false;
let busy = false;

export function bulkDraft(item) {
  return Object.fromEntries(FIELDS.map(({ name }) => [name, String(item[name] ?? '')]));
}

export function bulkChanges(item, draft) {
  const original = bulkDraft(item);
  const changes = {};
  for (const field of FIELDS) {
    const raw = draft[field.name];
    if (typeof raw !== 'string') throw new Error(`${field.label}: Texteingabe erwartet.`);
    if (raw === original[field.name]) continue;
    const text = raw.trim();
    if (field.maxLength && [...text].length > field.maxLength) {
      throw new Error(`${field.label}: höchstens ${field.maxLength} Zeichen erlaubt.`);
    }
    const value = field.name === 'weight_grams' ? optionalWeight(text)
      : field.type === 'number' ? optionalInteger(text)
      : field.type === 'url' ? productURL(text)
      : field.name === 'parts' ? text || null : text;
    const previous = field.type === 'number' && item[field.name] != null
      ? Number(item[field.name]) : item[field.name] ?? (field.name === 'parts' || field.type === 'url' ? null : '');
    if (value !== previous) changes[field.name] = value;
  }
  return changes;
}

export function bulkRowChanged(row) {
  const original = bulkDraft(row.item);
  return Boolean(row.invalidFields?.size) || FIELDS.some(({ name }) => row.draft[name] !== original[name]);
}

export async function loadBulkPage(pageNumber) {
  const select = ['id', 'name', 'product_number', 'usage_count', 'updated_at', ...FIELDS.map(({ name }) => name)].join(',');
  const data = await rest('items', `?select=${select}&order=name.asc,id.asc&limit=${PAGE_SIZE + 1}&offset=${pageNumber * PAGE_SIZE}`);
  if (!Array.isArray(data)) throw new Error('Unerwartete Antwort beim Laden der Artikel.');
  return { items: data.slice(0, PAGE_SIZE), hasNext: data.length > PAGE_SIZE };
}

async function patchItem(item, changes) {
  if (!item.updated_at) throw new Error('Änderungsstand fehlt. Bitte die Seite neu laden.');
  const saved = await rest('items',
    `?id=eq.${encodeURIComponent(item.id)}&updated_at=eq.${encodeURIComponent(item.updated_at)}`, {
      method: 'PATCH', body: changes, headers: { Prefer: 'return=representation' },
    });
  if (!saved?.length) {
    throw new Error('Artikel wurde zwischenzeitlich geändert oder entfernt. Eingaben sichern und die Seite neu laden.');
  }
  if (saved.length !== 1 || saved[0].id !== item.id || !saved[0].updated_at) {
    throw new Error('Die Speicherung konnte nicht bestätigt werden. Eingaben sichern und die Seite neu laden.');
  }
  return saved[0];
}

export async function saveBulkRows(records, save = patchItem) {
  const result = { saved: 0, failed: 0 };
  for (const row of records.filter(bulkRowChanged)) {
    row.error = false;
    try {
      if (row.invalidFields?.size) throw new Error('Bitte gültige Zahlen eingeben.');
      const changes = bulkChanges(row.item, row.draft);
      if (Object.keys(changes).length) {
        row.item = await save(row.item, changes);
        result.saved++;
        row.feedback = 'Gespeichert.';
      } else {
        row.feedback = 'Unverändert.';
      }
      row.draft = bulkDraft(row.item);
    } catch (error) {
      row.error = true;
      row.feedback = error.message;
      result.failed++;
    }
  }
  return result;
}

function updateControls() {
  const dirty = rows.filter(bulkRowChanged).length;
  const unavailable = busy || !navigator.onLine;
  document.querySelector('#bulk-fields').disabled = unavailable || !loaded;
  document.querySelector('#bulk-save').disabled = unavailable || !dirty;
  document.querySelector('#bulk-previous').disabled = unavailable || !loaded || page === 0;
  document.querySelector('#bulk-next').disabled = unavailable || !loaded || !hasNext;
  document.querySelector('#bulk-reload').disabled = unavailable;
  document.querySelector('#bulk-dirty').textContent = dirty ? `${dirty} Artikel mit ungespeicherten Änderungen.` : 'Keine ungespeicherten Änderungen.';
}

function updateRow(row, normalize = false) {
  row.node.classList.toggle('bulk-row-error', row.error);
  row.feedbackNode.textContent = row.feedback;
  if (normalize) {
    for (const { name } of FIELDS) row.controls[name].value = row.draft[name];
  }
}

function renderRows() {
  const body = document.querySelector('#bulk-rows');
  body.replaceChildren(...rows.map((row, index) => {
    row.node = element('tr');
    const identity = element('th');
    identity.scope = 'row';
    const identityId = `bulk-item-${index}`;
    identity.id = identityId;
    identity.append(element('strong', row.item.name),
      element('span', `Produktnummer: ${row.item.product_number || '—'}`, 'muted'));
    row.node.append(identity);
    row.controls = {};
    for (const field of FIELDS) {
      const cell = element('td');
      const control = element(field.type === 'textarea' ? 'textarea' : 'input');
      if (field.type !== 'textarea') control.type = field.type;
      control.name = `${row.item.id}-${field.name}`;
      control.value = row.draft[field.name];
      control.setAttribute('aria-label', `${field.label}: ${row.item.name}`);
      control.setAttribute('aria-describedby', `bulk-status-${index}`);
      if (field.type === 'number') {
        control.min = '0';
        control.max = field.max;
        control.step = field.step;
      }
      if (field.maxLength) control.maxLength = field.maxLength;
      control.addEventListener('input', () => {
        row.draft[field.name] = control.value;
        if (control.validity.badInput) row.invalidFields.add(field.name);
        else row.invalidFields.delete(field.name);
        row.error = false;
        row.feedback = bulkRowChanged(row) ? 'Geändert, noch nicht gespeichert.' : '';
        updateRow(row);
        updateControls();
      });
      row.controls[field.name] = control;
      cell.append(control);
      row.node.append(cell);
    }
    row.node.append(element('td', String(row.item.usage_count)));
    const feedbackCell = element('td', undefined, 'bulk-row-status');
    row.feedbackNode = element('span');
    row.feedbackNode.id = `bulk-status-${index}`;
    row.feedbackNode.setAttribute('role', 'status');
    feedbackCell.append(row.feedbackNode);
    row.node.append(feedbackCell);
    return row.node;
  }));
  document.querySelector('#bulk-page').textContent = `Seite ${page + 1} · ${rows.length} Artikel`;
  document.querySelector('#bulk-empty').hidden = rows.length > 0;
}

async function changePage(target) {
  if (busy) return;
  if (rows.some(bulkRowChanged) && !confirm('Ungespeicherte Änderungen dieser Seite verwerfen?')) return;
  busy = true;
  updateControls();
  status(`Seite ${target + 1} wird geladen …`);
  try {
    if (!navigator.onLine) throw new Error('Bulk-Edit benötigt eine Internetverbindung.');
    const data = await loadBulkPage(target);
    rows = data.items.map((item) => ({
      item, draft: bulkDraft(item), invalidFields: new Set(), feedback: '', error: false,
    }));
    page = target;
    hasNext = data.hasNext;
    loaded = true;
    renderRows();
    status('');
  } catch (error) {
    status(`Artikel konnten nicht geladen werden: ${error.message} Vorhandene Eingaben bleiben erhalten.`);
  } finally {
    busy = false;
    updateControls();
  }
}

async function submitPage(event) {
  event.preventDefault();
  if (busy) return;
  if (!navigator.onLine) {
    status('Offline: Änderungen bleiben erhalten und können erst mit Internet gespeichert werden.');
    return;
  }
  busy = true;
  updateControls();
  status('Änderungen werden gespeichert …');
  try {
    const result = await saveBulkRows(rows);
    for (const row of rows) updateRow(row, !row.error);
    status(`${result.saved} Artikel gespeichert. ${result.failed} fehlgeschlagen.${result.failed ? ' Fehler stehen in der jeweiligen Zeile; nicht gespeicherte Eingaben bleiben erhalten.' : ''}`);
  } finally {
    busy = false;
    updateControls();
  }
}

export async function initBulkEdit() {
  document.querySelector('#bulk-previous').addEventListener('click', () => changePage(page - 1));
  document.querySelector('#bulk-next').addEventListener('click', () => changePage(page + 1));
  document.querySelector('#bulk-reload').addEventListener('click', () => changePage(page));
  document.querySelector('#bulk-form').addEventListener('submit', submitPage);
  window.addEventListener('beforeunload', (event) => {
    if (busy || rows.some(bulkRowChanged)) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  document.addEventListener('click', (event) => {
    if (busy && event.target.closest('a[href]')) {
      event.preventDefault();
      status('Bitte warten, bis der laufende Vorgang abgeschlossen ist.');
    }
  });
  for (const name of ['online', 'offline']) {
    window.addEventListener(name, () => {
      updateControls();
      status(navigator.onLine ? 'Wieder online. Nicht gespeicherte Eingaben bleiben erhalten.'
        : 'Offline: Nicht gespeicherte Eingaben bleiben erhalten. Speichern benötigt Internet.');
    });
  }
  await changePage(0);
}
