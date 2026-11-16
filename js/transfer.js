import { list, rest } from './supabase.js';
import { loadConnection } from './auth.js';
import { status } from './app.js';
import { createZip, readZip, MAX_ZIP_SIZE } from './zip.js';
import { downloadImage, restoreImage, validateWebP } from './storage.js';
import { productDetails, optionalPrice } from './product.js';

const TABLES = ['storage_locations', 'storage_compartments', 'items', 'stock_entries', 'order_entries'];
const FIELDS = {
  storage_locations: ['id', 'name'],
  storage_compartments: ['id', 'location_id', 'name'],
  items: ['id', 'name', 'product_number', 'weight_grams', 'price', 'description', 'category',
    'preparation_minutes', 'thawing_minutes', 'qr_code', 'notes',
    'product_url', 'parts', 'favorite', 'usage_count', 'rating'],
  stock_entries: ['id', 'item_id', 'location_id', 'compartment_id', 'quantity'],
  order_entries: ['id', 'item_id', 'quantity'],
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
    const records = table === 'order_entries' && data[table] === undefined ? [] : data[table];
    requireValue(Array.isArray(records), `${table} fehlt.`);
    ids[table] = new Set();
    result[table] = records.map((row) => {
      requireValue(row && typeof row === 'object' && !Array.isArray(row), `${table}: Datensatz erwartet.`);
      const clean = pick(row, FIELDS[table]);
      for (const field of FIELDS[table].filter((key) => key === 'id' || key.endsWith('_id'))) {
        if (field === 'compartment_id' && clean[field] === null) continue;
        requireValue(typeof clean[field] === 'string' && UUID.test(clean[field]), `${table}: ${field} ist keine UUID.`);
        clean[field] = clean[field].toLowerCase();
      }
      requireValue(!ids[table].has(clean.id), `${table}: doppelte ID.`);
      ids[table].add(clean.id);
      if (table !== 'stock_entries' && table !== 'order_entries') {
        requireValue(typeof clean.name === 'string' && clean.name.trim().length > 0 &&
          [...clean.name].length <= 200, `${table}: Name muss 1–200 Zeichen enthalten.`);
      }
      if (table === 'items') {
        Object.assign(clean, productDetails(clean));
        clean.price = optionalPrice(clean.price);
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
      if (table === 'order_entries') {
        requireValue(Number.isInteger(clean.quantity) && clean.quantity > 0 &&
          clean.quantity <= 2147483647, 'Bestellmenge ist ungültig.');
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
  const orderedProducts = new Set();
  for (const row of result.order_entries) {
    requireValue(ids.items.has(row.item_id), 'Bestelleintrag verweist auf fehlendes Produkt.');
    requireValue(!orderedProducts.has(row.item_id), 'Doppeltes Produkt auf der Bestellliste.');
    orderedProducts.add(row.item_id);
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
        if (table === 'order_entries') {
          match ??= [...known.values()].find((candidate) => candidate.item_id === row.item_id);
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

export function validateImageArchive(manifest, files) {
  requireValue(manifest?.format === 'eisfach-zip' && manifest.version === 1, 'ZIP-Format nicht unterstützt.');
  const data = validateBackup(manifest.data);
  requireValue(Array.isArray(manifest.images), 'Bildverzeichnis fehlt.');
  const products = new Set(data.items.map((item) => item.id));
  const ids = new Set();
  const paths = new Set();
  const images = manifest.images.map((image) => {
    requireValue(image && typeof image === 'object', 'Ungültiger Bildeintrag.');
    const clean = pick(image, ['id', 'item_id', 'file_id', 'caption', 'sort_order']);
    for (const field of ['id', 'item_id', 'file_id']) {
      requireValue(typeof clean[field] === 'string' && UUID.test(clean[field]), `Bild: ${field} ist ungültig.`);
      clean[field] = clean[field].toLowerCase();
    }
    requireValue(products.has(clean.item_id), 'Bild verweist auf fehlendes Produkt.');
    requireValue(typeof clean.caption === 'string' && Number.isInteger(clean.sort_order) &&
      clean.sort_order >= -2147483648 && clean.sort_order <= 2147483647, 'Bildbeschriftung oder Reihenfolge ist ungültig.');
    const path = `${clean.item_id}/${clean.file_id}`;
    requireValue(!ids.has(clean.id) && !paths.has(path), 'Doppeltes Bild.');
    ids.add(clean.id);
    paths.add(path);
    const bytes = files.get(`images/${clean.id}.webp`);
    requireValue(bytes instanceof Uint8Array, 'Bilddatei fehlt.');
    validateWebP(bytes);
    return clean;
  });
  requireValue(files.size === images.length + 1, 'Unerwartete Dateien im Archiv.');
  return { data, images, files };
}

export async function createImageArchive(data, records, download, onProgress = () => {}) {
  requireValue(records.length <= 1999, 'Maximal 1999 Bilder pro ZIP-Sicherung.');
  const files = new Map();
  const manifest = { format: 'eisfach-zip', version: 1, data, images: [] };
  let totalSize = 0;
  for (const record of records) {
    const segments = record.path.split('/');
    requireValue(segments.length === 3 && segments[0] === data.inventory_id &&
      segments[1] === record.item_id && UUID.test(segments[2].slice(0, -5)) &&
      segments[2].endsWith('.webp'), 'Ungültiger Bilderpfad.');
    const image = { ...pick(record, ['id', 'item_id', 'caption', 'sort_order']),
      file_id: segments[2].slice(0, -5) };
    const bytes = await download(record.path);
    validateWebP(bytes);
    totalSize += bytes.length;
    requireValue(totalSize <= MAX_ZIP_SIZE, 'ZIP-Sicherung ist größer als 100 MB.');
    requireValue(!files.has(`images/${image.id}.webp`), 'Doppeltes Bild.');
    files.set(`images/${image.id}.webp`, bytes);
    manifest.images.push(image);
    onProgress(manifest.images.length, records.length);
  }
  const json = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  requireValue(json.length <= MAX_FILE_SIZE, 'JSON-Daten im ZIP sind größer als 10 MB.');
  files.set('inventory.json', json);
  validateImageArchive(manifest, files);
  return createZip(files);
}

export function readImageArchive(bytes) {
  const files = readZip(bytes);
  const json = files.get('inventory.json');
  requireValue(json.length <= MAX_FILE_SIZE, 'JSON-Daten im ZIP sind größer als 10 MB.');
  return validateImageArchive(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json)), files);
}

export async function importArchiveImages(archive, inventoryId, existing, upload, onProgress = () => {}) {
  const known = new Map(existing.map((image) => [image.id, image]));
  const knownPaths = new Set(existing.map((image) => image.path));
  let added = 0;
  let skipped = 0;
  try {
    for (const source of archive.images) {
      const id = await importId(source.id, archive.data.inventory_id, inventoryId, 'item_images');
      const itemId = await importId(source.item_id, archive.data.inventory_id, inventoryId, 'items');
      const fileId = await importId(source.file_id, archive.data.inventory_id, inventoryId, 'image_files');
      const path = `${inventoryId}/${itemId}/${fileId}.webp`;
      if (known.has(id) && (known.get(id).item_id !== itemId || known.get(id).path !== path)) {
        throw new Error('Ein vorhandenes Bild hat eine abweichende Zuordnung.');
      }
      if (known.has(id) || knownPaths.has(path)) skipped++;
      else {
        await upload({ id, item_id: itemId, inventory_id: inventoryId,
          caption: source.caption, sort_order: source.sort_order },
        archive.files.get(`images/${source.id}.webp`), fileId);
        knownPaths.add(path);
        added++;
      }
      onProgress(added, skipped);
    }
  } catch (error) {
    throw new Error(`Bildimport abgebrochen: ${added} Bilder ergänzt, ${skipped} übersprungen. ` +
      `Die Daten und bereits hochgeladenen Bilder bleiben erhalten. Dieselbe ZIP-Datei erneut importieren. ${error.message}`);
  }
  return { added, skipped };
}

export function initTransfer() {
  const exportButton = document.querySelector('#export-json');
  const zipButton = document.querySelector('#export-zip');
  const importButton = document.querySelector('#import-json');
  const fileInput = document.querySelector('#import-file');
  const confirmation = document.querySelector('#import-confirm');
  const preview = document.querySelector('#import-preview');
  const form = document.querySelector('#import-form');
  let backup = null;
  let archive = null;
  let busy = false;
  let fileRevision = 0;
  const update = () => {
    exportButton.disabled = busy || !navigator.onLine;
    zipButton.disabled = busy || !navigator.onLine;
    importButton.disabled = busy || !backup || !confirmation.checked || !navigator.onLine;
    fileInput.disabled = confirmation.disabled = busy;
  };
  window.addEventListener('offline', update);
  window.addEventListener('online', update);
  confirmation.addEventListener('change', update);
  fileInput.addEventListener('change', async () => {
    const revision = ++fileRevision;
    backup = null;
    archive = null;
    confirmation.checked = false;
    preview.textContent = 'Datei wird geprüft …';
    update();
    try {
      const file = fileInput.files[0];
      if (!file) { preview.textContent = 'Bitte eine Exportdatei auswählen.'; return; }
      const zip = file.name.toLowerCase().endsWith('.zip');
      if (file.size > (zip ? MAX_ZIP_SIZE : MAX_FILE_SIZE)) {
        throw new Error(`Die Datei ist größer als ${zip ? '100' : '10'} MB.`);
      }
      const parsedArchive = zip ? readImageArchive(new Uint8Array(await file.arrayBuffer())) : null;
      const parsed = parsedArchive ? parsedArchive.data : validateBackup(JSON.parse(await file.text()));
      if (revision !== fileRevision) return;
      backup = parsed;
      archive = parsedArchive;
      preview.textContent = `${backup.items.length} Produkte, ${backup.stock_entries.length} Bestandspositionen, ` +
        `${backup.storage_locations.length} Lagerorte, ${backup.storage_compartments.length} Fächer, ` +
        `${backup.order_entries.length} Bestelleinträge` +
        (archive ? `, ${archive.images.length} Bilder.` : '.');
    } catch (error) {
      if (revision === fileRevision) preview.textContent = `Datei konnte nicht geladen werden: ${error.message}`;
    } finally { update(); }
  });
  const runExport = async (withImages) => {
    if (busy) return;
    busy = true;
    update();
    status('Daten werden für den Export abgerufen …');
    let url;
    try {
      const data = createBackup(await loadData(), loadConnection().inventoryId);
      const blob = withImages
        ? await createImageArchive(data, await list('item_images', '?select=id,item_id,path,caption,sort_order&order=sort_order.asc,created_at.asc,id.asc'),
          downloadImage, (count, total) => status(`Bilder werden exportiert: ${count} von ${total} …`))
        : new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `eisfach-${new Date().toISOString().slice(0, 10)}.${withImages ? 'zip' : 'json'}`;
      document.body.append(link);
      link.click();
      link.remove();
      status(`${withImages ? 'ZIP-Export inklusive Bilder' : 'JSON-Export'} zum Herunterladen bereitgestellt.`);
    } catch (error) { status(`Export fehlgeschlagen: ${error.message}`); }
    finally {
      if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
      busy = false;
      update();
    }
  };
  exportButton.addEventListener('click', () => runExport(false));
  zipButton.addEventListener('click', () => runExport(true));
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
      let images = null;
      if (archive) {
        status(`Daten importiert: ${result.added} ergänzt, ${result.skipped} übersprungen. Bilder werden vorbereitet …`);
        try {
          images = await importArchiveImages(archive, loadConnection().inventoryId,
            await list('item_images', '?select=id,item_id,path&order=id.asc'), restoreImage,
            (added, skipped) => status(`Daten importiert: ${result.added} ergänzt, ${result.skipped} übersprungen. ` +
              `Bilder: ${added} ergänzt, ${skipped} übersprungen …`));
        } catch (error) {
          throw new Error(`Produkt-/Bestandsdaten bereits verarbeitet: ${result.added} ergänzt, ` +
            `${result.skipped} übersprungen. ${error.message} ZIP-Import kann erneut versucht werden.`);
        }
      }
      status(`Import abgeschlossen: ${result.added} Datensätze ergänzt, ${result.skipped} übersprungen.` +
        (images ? ` ${images.added} Bilder ergänzt, ${images.skipped} übersprungen.` : ''));
      confirmation.checked = false;
    } catch (error) { status(`Import fehlgeschlagen: ${error.message}`); }
    finally { busy = false; update(); }
  });
  update();
}
