import { rest, list } from './supabase.js';
import { loadConnection, saveSnapshot, loadSnapshot } from './auth.js';
import { uploadImage, imageURL, removeImage } from './storage.js';
import { renderQR, scanQR } from './scanner.js';
import { element, action, status } from './app.js';
import { locationLabel, populateCompartments, locationSelection } from './locations.js';

let items = [];
let stockEntries = [];
let locations = [];
let compartments = [];
let offline = false;
let currentView = 'stock';
let detailVersion = 0;
let editingVersion = null;
let editingItem = null;
let editorBusy = false;
let stockEditingVersion = null;
const form = () => document.querySelector('#item-form');
const dialog = () => document.querySelector('#item-dialog');
const stockForm = () => document.querySelector('#stock-form');
const stockDialog = () => document.querySelector('#stock-dialog');

export function hasStock(entry) {
  return Number(entry.quantity) > 0 || Number(entry.weight_grams) > 0;
}

export function groupCatalog(products) {
  const groups = new Map();
  for (const product of products) {
    const category = product.category || '';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(product);
  }
  return [...groups].sort(([a], [b]) =>
    a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'de'))
    .map(([category, entries]) => ({
      category,
      items: entries.sort((a, b) => a.name.localeCompare(b.name, 'de')),
    }));
}

export function productPackInfo(notes = '') {
  const field = (name) => notes.match(new RegExp(`^${name}:[ \\t]*([^\\r\\n]*)`, 'mi'))?.[1].trim() || '—';
  return { parts: field('Teile'), weight: field('Gewicht') };
}

export function productStockLabel(itemId, entries) {
  const active = entries.filter((entry) => entry.item_id === itemId && hasStock(entry));
  if (!active.length) return 'Kein Bestand';
  const quantity = active.reduce((sum, entry) => sum + Number(entry.quantity), 0);
  const positions = `${active.length} Position${active.length === 1 ? '' : 'en'}`;
  return `Bestand: ${quantity > 0 ? `${quantity} Stück · ` : ''}${positions}`;
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
    const [loadedItems, loadedStock, loadedLocations, loadedCompartments] = await Promise.all([
      list('items', '?select=*&order=name.asc,id.asc'),
      list('stock_entries', '?select=*&order=created_at.asc,id.asc'),
      list('storage_locations', '?select=*&order=name.asc,id.asc'),
      list('storage_compartments', '?select=*&order=name.asc,id.asc'),
    ]);
    items = loadedItems;
    stockEntries = loadedStock;
    locations = loadedLocations;
    compartments = loadedCompartments;
    offline = false;
    saveSnapshot(items, stockEntries, locations, compartments);
    status('');
  } catch (error) {
    const snapshot = loadSnapshot();
    if (!snapshot) throw error;
    items = snapshot.items;
    stockEntries = snapshot.stockEntries;
    locations = snapshot.locations;
    compartments = snapshot.compartments;
    offline = true;
    status(`Server nicht erreichbar: ${error.message} Offline-Kopie vom ${new Date(snapshot.savedAt).toLocaleString('de-DE')}. Nur Lesen möglich.`);
  }
  const selected = document.querySelector('#category').value;
  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))].sort();
  document.querySelector('#category').replaceChildren(new Option('Alle Kategorien', ''),
    ...categories.map((category) => new Option(category, category)));
  document.querySelector('#category').value = categories.includes(selected) ? selected : '';
  document.querySelector('#categories').replaceChildren(...categories.map((category) => new Option(category)));
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
  const label = (entry) => locationLabel(entry, locations, compartments);
  const visible = currentView === 'catalog'
    ? items.filter((item) => matches(item, stockEntries.filter((entry) => entry.item_id === item.id).map(label)))
    : stockEntries.filter((entry) => hasStock(entry) && itemById.has(entry.item_id) &&
        matches(itemById.get(entry.item_id), [label(entry)]));
  document.querySelector('#empty').hidden = visible.length > 0;
  document.querySelector('#empty').textContent = currentView === 'catalog'
    ? 'Keine passenden Produkte vorhanden.' : 'Keine passenden Bestandspositionen vorhanden.';
  const renderCard = (record) => {
    const entry = currentView === 'stock' ? record : null;
    const item = entry ? itemById.get(entry.item_id) : record;
    const card = element('article', undefined, 'card');
    if (!entry) {
      card.classList.add('catalog-card');
      const pack = productPackInfo(item.notes);
      card.append(element('h3', item.name),
        element('p', `Teile: ${pack.parts} · Gewicht: ${pack.weight}`, 'muted'),
        element('p', productStockLabel(item.id, stockEntries)));
      const buttons = element('div', undefined, 'actions compact-actions');
      const edit = action('Bearbeiten', () => editItem(item));
      const add = action('Einlagern', () => editStock(null, item.id));
      edit.disabled = add.disabled = offline;
      buttons.append(edit, add);
      card.append(buttons);
      return card;
    }
    card.append(element('h2', item.name), element('p', item.description || ''),
      element('p', [item.category, label(entry)].filter(Boolean).join(' · '), 'muted'));
    if (item.notes) card.append(element('p', item.notes));
    const times = [
      item.preparation_minutes != null ? `Zubereitung: ${item.preparation_minutes} Min.` : '',
      item.thawing_minutes != null ? `Auftauen: ${item.thawing_minutes} Min.` : '',
    ].filter(Boolean);
    if (times.length) card.append(element('p', times.join(' · ')));
    card.append(element('p', `Stückzahl: ${entry.quantity}${entry.weight_grams != null ? ` · Gesamtgewicht: ${entry.weight_grams} g` : ''}`));
    const buttons = element('div', undefined, 'actions');
    const edit = action('Position bearbeiten', () => editStock(entry));
    const remove = action('Position entfernen', () => deleteStock(entry), 'danger');
    const add = action('Einlagern', () => editStock(null, item.id));
    edit.disabled = remove.disabled = add.disabled = offline;
    buttons.append(edit, add, action('Bilder & QR', () => showDetails(item)), remove);
    card.append(document.createElement('hr'), buttons);
    return card;
  };
  const content = currentView === 'catalog'
    ? groupCatalog(visible).map((group, index) => {
      const section = element('section', undefined, 'catalog-category');
      const heading = element('h2', group.category || 'Ohne Kategorie');
      heading.id = `catalog-category-${index}`;
      section.setAttribute('aria-labelledby', heading.id);
      const cards = element('div', undefined, 'grid');
      cards.append(...group.items.map(renderCard));
      section.append(heading, cards);
      return section;
    })
    : visible.map(renderCard);
  document.querySelector('#items').replaceChildren(...content);
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
  editingItem = item || null;
  editingVersion = item?.updated_at || null;
  form().reset();
  for (const key of ['id', 'name', 'description', 'category', 'notes', 'preparation_minutes', 'thawing_minutes']) {
    form().elements[key].value = item?.[key] ?? '';
  }
  document.querySelector('#editor-title').textContent = item ? 'Produkt bearbeiten' : 'Produkt anlegen';
  document.querySelector('#editor-status').textContent = '';
  updateEditorActions();
  dialog().showModal();
}

function updateEditorActions() {
  form().querySelector('[type=submit]').disabled = editorBusy || offline;
  document.querySelector('#cancel-item').disabled = editorBusy;
  const images = document.querySelector('#item-images');
  const remove = document.querySelector('#delete-item');
  images.hidden = remove.hidden = !editingItem;
  images.disabled = editorBusy;
  remove.disabled = editorBusy || offline;
}

async function editorAction(handler) {
  editorBusy = true;
  updateEditorActions();
  document.querySelector('#editor-status').textContent = '';
  try {
    await handler();
  } catch (error) {
    if (dialog().open) document.querySelector('#editor-status').textContent = error.message;
    else status(error.message);
  } finally {
    editorBusy = false;
    updateEditorActions();
  }
}

async function saveItem(event) {
  event.preventDefault();
  editorBusy = true;
  updateEditorActions();
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
    editingItem = saved[0];
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
    editorBusy = false;
    updateEditorActions();
  }
}

async function deleteItem(item) {
  if (offline) throw new Error('Offline sind keine Änderungen möglich.');
  if (!confirm(`Produkt „${item.name}“ unwiderruflich löschen? Alle zugehörigen Bestandspositionen und Bilder werden ebenfalls gelöscht.`)) return;
  const images = await list('item_images', `?item_id=eq.${item.id}&select=*&order=id.asc`);
  // Objekte vor dem Artikel löschen, solange die Storage-Policy dessen Existenz prüfen kann.
  for (const image of images) await removeImage(image);
  await rest('items', `?id=eq.${item.id}`, { method: 'DELETE' });
  dialog().close();
  await refresh();
}

function editStock(entry, itemId) {
  stockEditingVersion = entry?.updated_at || null;
  stockForm().reset();
  stockForm().elements.item_id.replaceChildren(...items.map((item) => new Option(item.name, item.id)));
  stockForm().elements.id.value = entry?.id ?? '';
  stockForm().elements.item_id.value = entry?.item_id ?? itemId ?? items[0]?.id ?? '';
  stockForm().elements.location_id.replaceChildren(new Option('Bitte Ort auswählen', ''),
    ...locations.map((location) => new Option(location.name, location.id)));
  stockForm().elements.location_id.value = entry?.location_id ?? '';
  populateCompartments(stockForm().elements.compartment_id, compartments,
    stockForm().elements.location_id.value, entry?.compartment_id ?? '');
  stockForm().elements.quantity.value = entry?.quantity ?? 1;
  stockForm().elements.weight_grams.value = entry?.weight_grams ?? '';
  document.querySelector('#stock-title').textContent = entry ? 'Bestandsposition bearbeiten' : 'Bestand hinzufügen';
  document.querySelector('#stock-status').textContent = locations.length
    ? '' : 'Bitte zuerst unter Einstellungen → Gefrierschrank einen Ort anlegen.';
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
    const body = { item_id: fields.item_id,
      ...locationSelection(fields, locations, compartments), ...stockValues(fields) };
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
    updateEditorActions();
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
  document.querySelector('#item-images').addEventListener('click', () =>
    editorAction(() => showDetails(editingItem)));
  document.querySelector('#delete-item').addEventListener('click', () =>
    editorAction(() => deleteItem(editingItem)));
  document.querySelector('#cancel-stock').addEventListener('click', () => stockDialog().close());
  dialog().addEventListener('cancel', (event) => {
    if (editorBusy) event.preventDefault();
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
  stockForm().elements.location_id.addEventListener('change', () => {
    populateCompartments(stockForm().elements.compartment_id, compartments,
      stockForm().elements.location_id.value);
  });
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
