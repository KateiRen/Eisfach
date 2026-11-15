import { rest, list } from './supabase.js';
import { loadConnection, saveSnapshot, loadSnapshot } from './auth.js';
import { uploadImage, imageURL, removeImage } from './storage.js';
import { renderQR, scanQR } from './scanner.js';
import { element, action, status } from './app.js';

let items = [];
let stockEntries = [];
let offline = false;
let currentView = 'stock';
let detailVersion = 0;
let editingVersion = null;
let stockEditingVersion = null;
const form = () => document.querySelector('#item-form');
const dialog = () => document.querySelector('#item-dialog');
const stockForm = () => document.querySelector('#stock-form');
const stockDialog = () => document.querySelector('#stock-dialog');

export function hasStock(entry) {
  return Number(entry.quantity) > 0 || Number(entry.weight_grams) > 0;
}

export function optionalInteger(value) {
  if (value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 2147483647) {
    throw new Error('Zeiten müssen nichtnegative ganze Minuten sein.');
  }
  return number;
}

export function stockValues(fields) {
  const quantity = Number(fields.quantity);
  const weight = fields.weight_grams === '' ? null : Number(fields.weight_grams);
  if (fields.quantity === '' || !Number.isInteger(quantity) || quantity < 0 || quantity > 2147483647) {
    throw new Error('Bitte eine gültige nichtnegative ganze Stückzahl eingeben.');
  }
  if (weight !== null && (!/^\d+(?:\.\d{1,3})?$/.test(fields.weight_grams) ||
      !Number.isFinite(weight) || weight < 0 || weight > 999999999.999)) {
    throw new Error('Bitte ein gültiges Gesamtgewicht mit höchstens drei Nachkommastellen eingeben.');
  }
  return { quantity, weight_grams: weight };
}

async function refresh() {
  try {
    const [loadedItems, loadedStock] = await Promise.all([
      list('items', '?select=*&order=name.asc,id.asc'),
      list('stock_entries', '?select=*&order=created_at.asc,id.asc'),
    ]);
    items = loadedItems;
    stockEntries = loadedStock;
    offline = false;
    saveSnapshot(items, stockEntries);
    status('');
  } catch (error) {
    const snapshot = loadSnapshot();
    if (!snapshot) throw error;
    items = snapshot.items;
    stockEntries = snapshot.stockEntries;
    offline = true;
    status(`Server nicht erreichbar: ${error.message} Offline-Kopie vom ${new Date(snapshot.savedAt).toLocaleString('de-DE')}. Nur Lesen möglich.`);
  }
  const selected = document.querySelector('#category').value;
  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))].sort();
  document.querySelector('#category').replaceChildren(new Option('Alle Kategorien', ''),
    ...categories.map((category) => new Option(category, category)));
  document.querySelector('#category').value = categories.includes(selected) ? selected : '';
  document.querySelector('#categories').replaceChildren(...categories.map((category) => new Option(category)));
  const locations = [...new Set(stockEntries.map((entry) => entry.location).filter(Boolean))].sort();
  document.querySelector('#locations').replaceChildren(...locations.map((location) => new Option(location)));
  document.querySelector('#add-item').disabled = offline;
  document.querySelector('#add-stock').disabled = offline || !items.length;
  render();
}

function render() {
  const search = document.querySelector('#search').value.toLocaleLowerCase('de');
  const category = document.querySelector('#category').value;
  const matches = (item, locations) => (!category || item.category === category) &&
    [item.name, item.description, item.category, item.notes, item.qr_code, ...locations]
      .some((value) => String(value || '').toLocaleLowerCase('de').includes(search));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const visible = currentView === 'catalog'
    ? items.filter((item) => matches(item, stockEntries.filter((entry) => entry.item_id === item.id).map((entry) => entry.location)))
    : stockEntries.filter((entry) => hasStock(entry) && itemById.has(entry.item_id) &&
        matches(itemById.get(entry.item_id), [entry.location]));
  document.querySelector('#empty').hidden = visible.length > 0;
  document.querySelector('#empty').textContent = currentView === 'catalog'
    ? 'Keine passenden Produkte vorhanden.' : 'Keine passenden Bestandspositionen vorhanden.';
  document.querySelector('#items').replaceChildren(...visible.map((record) => {
    const entry = currentView === 'stock' ? record : null;
    const item = entry ? itemById.get(entry.item_id) : record;
    const card = element('article', undefined, 'card');
    card.append(element('h2', item.name), element('p', item.description || ''),
      element('p', [item.category, entry?.location].filter(Boolean).join(' · '), 'muted'));
    if (item.notes) card.append(element('p', item.notes));
    const times = [
      item.preparation_minutes != null ? `Zubereitung: ${item.preparation_minutes} Min.` : '',
      item.thawing_minutes != null ? `Auftauen: ${item.thawing_minutes} Min.` : '',
    ].filter(Boolean);
    if (times.length) card.append(element('p', times.join(' · ')));
    if (entry) {
      card.append(element('p', `Stückzahl: ${entry.quantity}${entry.weight_grams != null ? ` · Gesamtgewicht: ${entry.weight_grams} g` : ''}`));
    } else {
      const count = stockEntries.filter((stock) => stock.item_id === item.id && hasStock(stock)).length;
      card.append(element('p', count ? `${count} Bestandsposition${count === 1 ? '' : 'en'}` : 'Kein Bestand', 'muted'));
    }
    const buttons = element('div', undefined, 'actions');
    const edit = action(entry ? 'Position bearbeiten' : 'Produkt bearbeiten', () => entry ? editStock(entry) : editItem(item));
    const remove = action(entry ? 'Position entfernen' : 'Produkt löschen', () => entry ? deleteStock(entry) : deleteItem(item), 'danger');
    const add = action('Einlagern', () => editStock(null, item.id));
    edit.disabled = remove.disabled = add.disabled = offline;
    buttons.append(edit, add, action('Bilder & QR', () => showDetails(item)), remove);
    card.append(document.createElement('hr'), buttons);
    return card;
  }));
}

function setView(view) {
  currentView = view;
  document.querySelector('#view-title').textContent = view === 'catalog' ? 'Produktkatalog' : 'Bestand';
  for (const link of document.querySelectorAll('[data-navigation="stock"], [data-navigation="catalog"]')) {
    if (link.dataset.navigation === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  render();
}

function editItem(item) {
  editingVersion = item?.updated_at || null;
  form().reset();
  for (const key of ['id', 'name', 'description', 'category', 'notes', 'preparation_minutes', 'thawing_minutes']) {
    form().elements[key].value = item?.[key] ?? '';
  }
  document.querySelector('#editor-title').textContent = item ? 'Produkt bearbeiten' : 'Produkt anlegen';
  document.querySelector('#editor-status').textContent = '';
  dialog().showModal();
}

async function saveItem(event) {
  event.preventDefault();
  const button = form().querySelector('[type=submit]');
  button.disabled = true;
  document.querySelector('#cancel-item').disabled = true;
  const feedback = document.querySelector('#editor-status');
  feedback.textContent = 'Wird gespeichert …';
  try {
    if (offline) throw new Error('Offline sind keine Änderungen möglich.');
    const fields = Object.fromEntries(new FormData(form()));
    const id = fields.id || crypto.randomUUID();
    const creating = !fields.id;
    const body = Object.fromEntries(['name', 'description', 'category', 'notes']
      .map((key) => [key, fields[key].trim()]));
    body.preparation_minutes = optionalInteger(fields.preparation_minutes);
    body.thawing_minutes = optionalInteger(fields.thawing_minutes);
    if (!body.name) throw new Error('Ein Name ist erforderlich.');
    if (creating) {
      body.id = id;
      body.inventory_id = loadConnection().inventoryId;
      body.qr_code = `eisfach:item:${id}`;
    }
    const versionFilter = editingVersion ? `&updated_at=eq.${encodeURIComponent(editingVersion)}` : '';
    const saved = await rest('items', creating ? '' : `?id=eq.${id}${versionFilter}`, {
      method: creating ? 'POST' : 'PATCH', body, headers: { Prefer: 'return=representation' },
    });
    if (!saved.length) {
      await refresh();
      throw new Error('Artikel wurde zwischenzeitlich geändert oder entfernt. Bitte schließen und erneut öffnen.');
    }
    // Nach erfolgreichem Artikel-Insert bei einem Bildfehler keinen zweiten Artikel erzeugen.
    form().elements.id.value = id;
    editingVersion = saved[0].updated_at;
    const files = [...form().elements.images.files];
    for (let index = 0; index < files.length; index++) {
      await uploadImage(id, files[index], index);
    }
    form().elements.images.value = '';
    dialog().close();
    await refresh();
  } catch (error) {
    feedback.textContent = `${error.message} Bereits gespeicherte Artikeldaten bleiben erhalten; bei teilweisem Bildupload bitte schließen und Bilder prüfen.`;
  } finally {
    button.disabled = false;
    document.querySelector('#cancel-item').disabled = false;
  }
}

async function deleteItem(item) {
  if (!confirm(`Produkt „${item.name}“ unwiderruflich löschen? Alle zugehörigen Bestandspositionen und Bilder werden ebenfalls gelöscht.`)) return;
  const images = await list('item_images', `?item_id=eq.${item.id}&select=*&order=id.asc`);
  // Objekte vor dem Artikel löschen, solange die Storage-Policy dessen Existenz prüfen kann.
  for (const image of images) await removeImage(image);
  await rest('items', `?id=eq.${item.id}`, { method: 'DELETE' });
  await refresh();
}

function editStock(entry, itemId) {
  stockEditingVersion = entry?.updated_at || null;
  stockForm().reset();
  stockForm().elements.item_id.replaceChildren(...items.map((item) => new Option(item.name, item.id)));
  stockForm().elements.id.value = entry?.id ?? '';
  stockForm().elements.item_id.value = entry?.item_id ?? itemId ?? items[0]?.id ?? '';
  stockForm().elements.location.value = entry?.location ?? '';
  stockForm().elements.quantity.value = entry?.quantity ?? 1;
  stockForm().elements.weight_grams.value = entry?.weight_grams ?? '';
  document.querySelector('#stock-title').textContent = entry ? 'Bestandsposition bearbeiten' : 'Bestand hinzufügen';
  document.querySelector('#stock-status').textContent = '';
  stockDialog().showModal();
}

async function saveStock(event) {
  event.preventDefault();
  const button = stockForm().querySelector('[type=submit]');
  const cancel = document.querySelector('#cancel-stock');
  const feedback = document.querySelector('#stock-status');
  button.disabled = cancel.disabled = true;
  feedback.textContent = 'Wird gespeichert …';
  try {
    if (offline) throw new Error('Offline sind keine Änderungen möglich.');
    const fields = Object.fromEntries(new FormData(stockForm()));
    if (!items.some((item) => item.id === fields.item_id)) throw new Error('Bitte ein Produkt auswählen.');
    const body = { item_id: fields.item_id, location: fields.location.trim(), ...stockValues(fields) };
    const creating = !fields.id;
    if (creating) body.inventory_id = loadConnection().inventoryId;
    const filter = creating ? '' : `?id=eq.${encodeURIComponent(fields.id)}&updated_at=eq.${encodeURIComponent(stockEditingVersion)}`;
    const saved = await rest('stock_entries', filter, {
      method: creating ? 'POST' : 'PATCH', body, headers: { Prefer: 'return=representation' },
    });
    if (!saved?.length) {
      await refresh();
      throw new Error('Position wurde zwischenzeitlich geändert oder entfernt. Bitte schließen und erneut öffnen.');
    }
    stockDialog().close();
    await refresh();
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    button.disabled = cancel.disabled = false;
  }
}

async function deleteStock(entry) {
  if (!confirm('Diese Bestandsposition entfernen? Das Produkt bleibt im Katalog erhalten.')) return;
  const deleted = await rest('stock_entries',
    `?id=eq.${encodeURIComponent(entry.id)}&updated_at=eq.${encodeURIComponent(entry.updated_at)}`,
    { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  await refresh();
  if (!deleted?.length) status('Position wurde zwischenzeitlich geändert oder entfernt. Bitte erneut versuchen.');
}

async function showDetails(item) {
  const version = ++detailVersion;
  document.querySelector('#detail-name').textContent = item.name;
  document.querySelector('#detail-code').textContent = item.qr_code;
  document.querySelector('#item-qr').replaceChildren();
  const gallery = document.querySelector('#detail-images');
  gallery.replaceChildren();
  const detail = document.querySelector('#detail-dialog');
  if (!detail.open) detail.showModal();
  try {
    await renderQR(document.querySelector('#item-qr'), item.qr_code);
  } catch {
    status('QR-Erzeugung ist noch nicht offline verfügbar. Der Artikelcode wird als Text angezeigt.');
  }
  if (offline) {
    gallery.append(element('p', 'Private Bilder sind nur online verfügbar.'));
    return;
  }
  const images = await list('item_images', `?item_id=eq.${item.id}&select=*&order=sort_order.asc,created_at.asc,id.asc`);
  for (const image of images) {
    const url = await imageURL(image.path);
    if (version !== detailVersion || !detail.open) return;
    const figure = element('figure');
    const img = element('img');
    img.src = url;
    img.alt = image.caption || item.name;
    img.loading = 'lazy';
    const remove = action('Bild löschen', async () => {
      if (offline) throw new Error('Offline sind keine Änderungen möglich.');
      if (!confirm('Dieses Bild löschen?')) return;
      await removeImage(image);
      figure.remove();
    }, 'danger');
    remove.disabled = offline;
    figure.append(img, element('figcaption', image.caption || ''), remove);
    gallery.append(figure);
  }
  if (!images.length) gallery.append(element('p', 'Noch keine Bilder. Bilder unter „Bearbeiten“ hinzufügen.'));
}

export async function initInventory() {
  window.addEventListener('offline', () => {
    offline = true;
    document.querySelector('#add-item').disabled = true;
    document.querySelector('#add-stock').disabled = true;
    document.querySelectorAll('#detail-images button').forEach((button) => { button.disabled = true; });
    render();
  });
  const syncView = () => setView(location.hash === '#catalog' ? 'catalog' : 'stock');
  window.addEventListener('hashchange', syncView);
  syncView();
  document.querySelector('#search').addEventListener('input', render);
  document.querySelector('#category').addEventListener('change', render);
  document.querySelector('#add-item').addEventListener('click', () => editItem());
  document.querySelector('#add-stock').addEventListener('click', () => editStock());
  document.querySelector('#cancel-item').addEventListener('click', () => dialog().close());
  document.querySelector('#cancel-stock').addEventListener('click', () => stockDialog().close());
  dialog().addEventListener('cancel', (event) => {
    if (form().querySelector('[type=submit]').disabled) event.preventDefault();
  });
  stockDialog().addEventListener('cancel', (event) => {
    if (stockForm().querySelector('[type=submit]').disabled) event.preventDefault();
  });
  document.querySelector('#close-detail').addEventListener('click', () => document.querySelector('#detail-dialog').close());
  document.querySelector('#detail-dialog').addEventListener('close', () => {
    detailVersion++;
    document.querySelector('#detail-images').replaceChildren();
  });
  form().addEventListener('submit', saveItem);
  stockForm().addEventListener('submit', saveStock);
  document.querySelector('#scan-item').addEventListener('click', async () => {
    try {
      const code = await scanQR();
      if (!code) return;
      const item = items.find((entry) => entry.qr_code === code);
      if (item) await showDetails(item);
      else status('Dieser Artikel gehört nicht zur geladenen Inventarliste.');
    } catch (error) { status(error.message); }
  });
  await refresh();
  if (!offline) {
    const inventories = await rest('inventories', '?select=name');
    document.querySelector('#inventory-name').textContent = inventories[0]?.name || 'Dein Inventar';
  }
}
