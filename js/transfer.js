import { list, rest } from './supabase.js';
import { loadConnection } from './auth.js';
import { status } from './app.js';

const TABLES = ['storage_locations', 'storage_compartments', 'items', 'stock_entries'];
const FIELDS = {
  storage_locations: ['id', 'name'],
  storage_compartments: ['id', 'location_id', 'name'],
  items: ['id', 'name', 'product_number', 'weight_grams', 'description', 'category',
    'preparation_minutes', 'thawing_minutes', 'qr_code', 'notes'],
  stock_entries: ['id', 'item_id', 'location_id', 'compartment_id', 'quantity'],
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const pick = (row, fields) => Object.fromEntries(fields.map((key) => [key, row[key]]));

function requireValue(condition, message) {
  if (!condition) throw new Error(`Ungültige Exportdatei: ${message}`);
}

export function validateBackup(data) {
  requireValue(data && data.format === 'eisfach' && data.version === 1, 'Format oder Version nicht unterstützt.');
  requireValue(typeof data.inventory_id === 'string' && UUID.test(data.inventory_id), 'Inventar-ID fehlt.');
  const result = { format: 'eisfach', version: 1, inventory_id: data.inventory_id.toLowerCase() };
  const ids = {};
  for (const table of TABLES) {
    requireValue(Array.isArray(data[table]), `${table} fehlt.`);
    ids[table] = new Set();
    result[table] = data[table].map((row) => {
      requireValue(row && typeof row === 'object' && !Array.isArray(row), `${table}: Datensatz erwartet.`);
      const clean = pick(row, FIELDS[table]);
      for (const field of FIELDS[table].filter((key) => key === 'id' || key.endsWith('_id'))) {
        if (field === 'compartment_id' && clean[field] === null) continue;
        requireValue(typeof clean[field] === 'string' && UUID.test(clean[field]), `${table}: ${field} ist keine UUID.`);
        clean[field] = clean[field].toLowerCase();
      }
      requireValue(!ids[table].has(clean.id), `${table}: doppelte ID.`);
      ids[table].add(clean.id);
      if (table !== 'stock_entries') {
        requireValue(typeof clean.name === 'string' && clean.name.trim().length > 0 &&
          [...clean.name].length <= 200, `${table}: Name muss 1–200 Zeichen enthalten.`);
      }
      if (table === 'items') {
        for (const field of ['product_number', 'description', 'category', 'notes']) {
          requireValue(typeof clean[field] === 'string', `items: ${field} muss Text sein.`);
        }
        requireValue([...clean.product_number].length <= 100, 'Produktnummer ist zu lang.');
        requireValue(clean.qr_code === null || typeof clean.qr_code === 'string', 'QR-Code muss Text oder null sein.');
        const weight = clean.weight_grams;
        requireValue(weight === null || ((typeof weight === 'number' || typeof weight === 'string') &&
          /^\d+(?:\.\d{1,3})?$/.test(String(weight)) && Number.isFinite(Number(weight)) &&
          Number(weight) >= 0 && Number(weight) < 1000000000), 'Packungsgewicht ist ungültig.');
        for (const field of ['preparation_minutes', 'thawing_minutes']) {
          requireValue(clean[field] === null || (Number.isInteger(clean[field]) &&
            clean[field] >= 0 && clean[field] <= 2147483647), `${field} ist ungültig.`);
        }
      }
      if (table === 'stock_entries') {
        requireValue(Number.isInteger(clean.quantity) && clean.quantity >= 0 &&
          clean.quantity <= 2147483647, 'Stückzahl ist ungültig.');
      }
      return clean;
    });
  }
  const compartments = new Map(result.storage_compartments.map((row) => [row.id, row]));
  const locationNames = new Set();
  for (const row of result.storage_locations) {
    requireValue(!locationNames.has(row.name), 'Doppelter Ortsname.');
    locationNames.add(row.name);
  }
  const compartmentNames = new Set();
  for (const row of result.storage_compartments) {
    requireValue(ids.storage_locations.has(row.location_id), 'Fach verweist auf fehlenden Ort.');
    const key = JSON.stringify([row.location_id, row.name]);
    requireValue(!compartmentNames.has(key), 'Doppelter Fachname am selben Ort.');
    compartmentNames.add(key);
  }
  for (const row of result.stock_entries) {
    requireValue(ids.items.has(row.item_id) && ids.storage_locations.has(row.location_id),
      'Bestandsposition verweist auf fehlendes Produkt oder fehlenden Ort.');
    requireValue(row.compartment_id === null ||
      compartments.get(row.compartment_id)?.location_id === row.location_id,
    'Bestandsposition verweist auf ein fehlendes oder unpassendes Fach.');
  }
  return result;
}

export function createBackup(data, inventoryId) {
  const backup = validateBackup({ format: 'eisfach', version: 1, inventory_id: inventoryId, ...data });
  return { ...backup, exported_at: new Date().toISOString() };
}

// Stable target-specific IDs make retries and repeated cross-inventory imports idempotent.
export async function importId(id, sourceInventory, targetInventory, table) {
  if (sourceInventory.toLowerCase() === targetInventory.toLowerCase()) return id;
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder()
    .encode(`eisfach-v1:${sourceInventory.toLowerCase()}:${targetInventory.toLowerCase()}:${table}:${id}`)));
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function importBackup(input, targetInventory, existing, insert, onProgress = () => {}) {
  const backup = validateBackup(input);
  const maps = {};
  let added = 0;
  let skipped = 0;
  try {
    for (const table of TABLES) {
      maps[table] = new Map();
      const known = new Map(existing[table].map((row) => [row.id, row]));
      for (const source of backup[table]) {
        const row = { ...source, inventory_id: targetInventory };
        row.id = await importId(source.id, backup.inventory_id, targetInventory, table);
        if ('location_id' in row) row.location_id = maps.storage_locations.get(source.location_id);
        if ('item_id' in row) row.item_id = maps.items.get(source.item_id);
        if ('compartment_id' in row) row.compartment_id = source.compartment_id === null
          ? null : maps.storage_compartments.get(source.compartment_id);
        let match = known.get(row.id);
        if (table === 'storage_locations' || table === 'storage_compartments') {
          if (match && (match.name !== row.name ||
              (table === 'storage_compartments' && match.location_id !== row.location_id))) {
            throw new Error('Ein bereits importierter Ort oder ein Fach wurde verändert. Bitte die Zuordnung vor erneutem Import prüfen.');
          }
          match ??= [...known.values()].find((candidate) => candidate.name === row.name &&
            (table === 'storage_locations' || candidate.location_id === row.location_id));
        }
        if (match) {
          maps[table].set(source.id, match.id);
          skipped++;
        } else {
          await insert(table, row);
          maps[table].set(source.id, row.id);
          known.set(row.id, row);
          added++;
        }
        onProgress(added, skipped);
      }
    }
  } catch (error) {
    throw new Error(`Import abgebrochen: ${added} ergänzt, ${skipped} übersprungen. ` +
      `Bereits ergänzte Daten bleiben erhalten; dieselbe Datei kann erneut versucht werden. ${error.message}`);
  }
  return { added, skipped };
}

async function loadData() {
  const rows = await Promise.all(TABLES.map((table) =>
    list(table, `?select=${FIELDS[table].join(',')}&order=id.asc`)));
  return Object.fromEntries(TABLES.map((table, index) => [table, rows[index]]));
}

export function initTransfer() {
  const exportButton = document.querySelector('#export-json');
  const importButton = document.querySelector('#import-json');
  const fileInput = document.querySelector('#import-file');
  const confirmation = document.querySelector('#import-confirm');
  const preview = document.querySelector('#import-preview');
  const form = document.querySelector('#import-form');
  let backup = null;
  let busy = false;
  let fileRevision = 0;
  const update = () => {
    exportButton.disabled = busy || !navigator.onLine;
    importButton.disabled = busy || !backup || !confirmation.checked || !navigator.onLine;
    fileInput.disabled = confirmation.disabled = busy;
  };
  window.addEventListener('offline', update);
  window.addEventListener('online', update);
  confirmation.addEventListener('change', update);
  fileInput.addEventListener('change', async () => {
    const revision = ++fileRevision;
    backup = null;
    confirmation.checked = false;
    preview.textContent = 'Datei wird geprüft …';
    update();
    try {
      const file = fileInput.files[0];
      if (!file) { preview.textContent = 'Bitte eine Exportdatei auswählen.'; return; }
      if (file.size > MAX_FILE_SIZE) throw new Error('Die Datei ist größer als 10 MB.');
      const parsed = validateBackup(JSON.parse(await file.text()));
      if (revision !== fileRevision) return;
      backup = parsed;
      preview.textContent = `${backup.items.length} Produkte, ${backup.stock_entries.length} Bestandspositionen, ` +
        `${backup.storage_locations.length} Lagerorte, ${backup.storage_compartments.length} Fächer.`;
    } catch (error) {
      if (revision === fileRevision) preview.textContent = `Datei konnte nicht geladen werden: ${error.message}`;
    } finally { update(); }
  });
  exportButton.addEventListener('click', async () => {
    busy = true;
    update();
    status('Daten werden für den Export abgerufen …');
    let url;
    try {
      const data = createBackup(await loadData(), loadConnection().inventoryId);
      url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `eisfach-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      status('JSON-Export zum Herunterladen bereitgestellt.');
    } catch (error) { status(`Export fehlgeschlagen: ${error.message}`); }
    finally {
      if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
      busy = false;
      update();
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!backup || !confirmation.checked || !navigator.onLine) {
      status('Bitte online eine gültige Datei auswählen und den Import bestätigen.');
      return;
    }
    busy = true;
    update();
    status('Import wird vorbereitet …');
    try {
      const result = await importBackup(backup, loadConnection().inventoryId, await loadData(),
        (table, row) => rest(table, '', { method: 'POST', body: row }),
        (added, skipped) => status(`Import läuft: ${added} ergänzt, ${skipped} übersprungen …`));
      status(`Import abgeschlossen: ${result.added} Datensätze ergänzt, ${result.skipped} übersprungen.`);
      confirmation.checked = false;
    } catch (error) { status(`Import fehlgeschlagen: ${error.message}`); }
    finally { busy = false; update(); }
  });
  update();
}
