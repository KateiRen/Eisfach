import { rest, list } from './supabase.js';
import { loadConnection, saveSnapshot, loadSnapshot } from './auth.js';
import { uploadImage, imageURL, removeImage, loadImageURL } from './storage.js';
import { element, action, status } from './app.js';
import { locationLabel, populateCompartments, locationSelection } from './locations.js';
import { loadSorting, compareOrder, orderRecords, orderStockPositions } from './ordering.js';

let items = [];
let stockEntries = [];
let locations = [];
let compartments = [];
let offline = false;
let currentView = 'stock';
let selectedCategory = '';
let sorting = null;
let renderVersion = 0;
let previewPaths = null;
const previewURLs = new Map();
let editingVersion = null;
let editingItem = null;
let editorBusy = false;
let editorImageVersion = 0;
let stockEditingVersion = null;
let stockEditingEntry = null;
let stockBusy = false;
const form = () => document.querySelector('#item-form');
const dialog = () => document.querySelector('#item-dialog');
const stockForm = () => document.querySelector('#stock-form');
const stockDialog = () => document.querySelector('#stock-dialog');

export function hasStock(entry) {
  return Number(entry.quantity) > 0;
}

export function matchesProduct(item, search, category, locationNames = []) {
  const query = search.toLocaleLowerCase('de');
  return (!category || item.category === category) &&
    [item.name, item.product_number, item.description, item.category, item.notes, item.qr_code, ...locationNames]
      .some((value) => String(value || '').toLocaleLowerCase('de').includes(query));
}

export function groupCatalog(products, getProduct = (product) => product, categoryOrder = []) {
  const groups = new Map();
  for (const product of products) {
    const category = getProduct(product).category || '';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(product);
  }
  return [...groups].sort(([a], [b]) =>
    compareOrder(a, b, categoryOrder) || (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'de')))
    .map(([category, entries]) => ({
      category,
      items: entries.sort((a, b) => getProduct(a).name.localeCompare(getProduct(b).name, 'de')),
    }));
}

export function productWeightLabel(item) {
  return item?.weight_grams == null ? '—'
    : `${Number(item.weight_grams).toLocaleString('de-DE', { maximumFractionDigits: 3 })} g`;
}

export function productPackInfo(item = {}) {
  const parts = (item.notes || '').match(/^Teile:[ \t]*([^\r\n]*)/mi)?.[1].trim() || '—';
  return { parts, weight: productWeightLabel(item) };
}

export function filterByProductNumber(products, query) {
  const number = query.trim().toLocaleLowerCase('de');
  return products.filter((item) => (item.product_number || '').toLocaleLowerCase('de').includes(number));
}

export function productStockLabel(itemId, entries) {
  const active = entries.filter((entry) => entry.item_id === itemId && hasStock(entry));
  if (!active.length) return 'Kein Bestand';
  const quantity = active.reduce((sum, entry) => sum + Number(entry.quantity), 0);
  const positions = `${active.length} Position${active.length === 1 ? '' : 'en'}`;
  return `Bestand: ${quantity > 0 ? `${quantity} Stück · ` : ''}${positions}`;
}

export function productSearchURL(productNumber, name) {
  const query = [productNumber.trim(), name.trim()].filter(Boolean).join(' ');
  if (!query) throw new Error('Bitte für die Google Suche einen Produktnamen oder eine Produktnummer eingeben.');
  const url = new URL('https://www.google.com/search');
  url.searchParams.set('q', query);
  return url.href;
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
  if (fields.quantity === '' || !Number.isInteger(quantity) || quantity < 0 || quantity > 2147483647) {
    throw new Error('Bitte eine gültige nichtnegative ganze Stückzahl eingeben.');
  }
  return { quantity };
}

export function optionalWeight(value) {
  if (value === '') return null;
  const weight = Number(value);
  if (!/^\d+(?:\.\d{1,3})?$/.test(value) ||
      !Number.isFinite(weight) || weight < 0 || weight > 999999999.999) {
    throw new Error('Bitte ein gültiges Packungsgewicht mit höchstens drei Nachkommastellen eingeben.');
  }
  return weight;
}

async function refresh() {
  const loading = document.querySelector('#loading');
  loading.hidden = false;
  document.querySelector('#empty').hidden = true;
  try {
    const [loadedItems, loadedStock, loadedLocations, loadedCompartments, loadedSorting] = await Promise.all([
      list('items', '?select=*&order=name.asc,id.asc'),
      list('stock_entries', '?select=*&order=created_at.asc,id.asc'),
      list('storage_locations', '?select=*&order=name.asc,id.asc'),
      list('storage_compartments', '?select=*&order=name.asc,id.asc'),
      loadSorting(),
    ]);
    items = loadedItems;
    stockEntries = loadedStock;
    sorting = loadedSorting;
    locations = orderRecords(loadedLocations, sorting?.locations);
    compartments = orderRecords(loadedCompartments, sorting?.compartments);
    offline = false;
    saveSnapshot(items, stockEntries, locations, compartments, sorting);
    status('');
  } catch (error) {
    const snapshot = loadSnapshot();
    if (!snapshot) throw error;
    items = snapshot.items;
    stockEntries = snapshot.stockEntries;
    locations = snapshot.locations;
    compartments = snapshot.compartments;
    sorting = snapshot.sorting ?? null;
    offline = true;
    status(`Server nicht erreichbar: ${error.message} Offline-Kopie vom ${new Date(snapshot.savedAt).toLocaleString('de-DE')}. Nur Lesen möglich.`);
  } finally {
    loading.hidden = true;
  }
  const categories = groupCatalog(items, (item) => item, sorting?.categories)
    .map((group) => group.category).filter(Boolean);
  renderCategoryFilters(categories);
  document.querySelector('#categories').replaceChildren(...categories.map((category) => new Option(category)));
  document.querySelector('#add-item').disabled = offline;
  previewPaths = null;
  previewURLs.clear();
  render();
}

function renderCategoryFilters(categories) {
  if (!categories.includes(selectedCategory)) selectedCategory = '';
  const buttons = ['', ...categories].map((category) => {
    const button = element('button', category || 'Alle Kategorien');
    button.type = 'button';
    button.dataset.category = category;
    button.setAttribute('aria-controls', 'items');
    button.addEventListener('click', () => {
      selectedCategory = selectedCategory === category ? '' : category;
      render();
    });
    return button;
  });
  document.querySelector('#category-filters').replaceChildren(...buttons);
}

function render() {
  const version = ++renderVersion;
  const search = document.querySelector('#search').value;
  const onlyWithStock = document.querySelector('#only-with-stock').checked;
  const compact = currentView === 'catalog' && document.querySelector('#compact-view').checked;
  const itemList = document.querySelector('#items');
  itemList.classList.toggle('compact-list', compact);
  for (const button of document.querySelectorAll('#category-filters button')) {
    button.setAttribute('aria-pressed', String(button.dataset.category === selectedCategory));
  }
  const itemById = new Map(items.map((item) => [item.id, item]));
  const label = (entry) => locationLabel(entry, locations, compartments);
  const visible = currentView === 'catalog'
    ? items.filter((item) =>
        (!onlyWithStock || stockEntries.some((entry) => entry.item_id === item.id && hasStock(entry))) &&
        matchesProduct(item, search, selectedCategory,
          stockEntries.filter((entry) => entry.item_id === item.id).map(label)))
    : orderStockPositions(stockEntries.filter((entry) => hasStock(entry) && itemById.has(entry.item_id) &&
        matchesProduct(itemById.get(entry.item_id), search, selectedCategory, [label(entry)])), locations, compartments);
  document.querySelector('#empty').hidden = !document.querySelector('#loading').hidden || visible.length > 0;
  document.querySelector('#empty').textContent = currentView === 'catalog'
    ? 'Keine passenden Produkte vorhanden.' : 'Keine passenden Bestandspositionen vorhanden.';
  const renderCard = (record) => {
    const entry = currentView === 'stock' ? record : null;
    const item = entry ? itemById.get(entry.item_id) : record;
    const card = element('article', undefined, 'card');
    if (!entry) {
      card.classList.add('catalog-card');
      if (compact) {
        const row = element('div', undefined, 'compact-row');
        row.append(element('span', item.name, 'compact-name'));
        const links = element('div', undefined, 'compact-actions');
        const edit = action('Bearbeiten', () => editItem(item), 'text-link');
        const add = action('Einlagern', () => editStock(null, item.id), 'text-link');
        edit.disabled = add.disabled = offline;
        edit.setAttribute('aria-label', `Bearbeiten: ${item.name}`);
        add.setAttribute('aria-label', `Einlagern: ${item.name}`);
        links.append(edit, add);
        row.append(links);
        card.append(row);
        return card;
      }
      card.classList.add('stock-card');
      const preview = element('div', undefined, 'stock-preview');
      const info = element('div', undefined, 'stock-info');
      const pack = productPackInfo(item);
      info.append(element('h3', item.name),
        element('p', `Produktnummer: ${item.product_number || '—'}`, 'muted'),
        element('p', `Teile: ${pack.parts} · Gewicht: ${pack.weight}`, 'muted'),
        element('p', productStockLabel(item.id, stockEntries)));
      const buttons = element('div', undefined, 'actions compact-actions');
      const edit = action('Bearbeiten', () => editItem(item));
      const add = action('Einlagern', () => editStock(null, item.id));
      edit.disabled = add.disabled = offline;
      buttons.append(edit, add);
      info.append(buttons);
      card.append(preview, info);
      loadStockPreview(item, preview, () => version === renderVersion);
      return card;
    }
    card.classList.add('stock-card');
    const preview = element('div', undefined, 'stock-preview');
    const info = element('div', undefined, 'stock-info');
    const heading = element('h3');
    const edit = action(item.name, () => editStock(entry), 'stock-name');
    edit.disabled = offline;
    heading.append(edit);
    info.append(heading,
      element('p', `Zubereitungszeit: ${item.preparation_minutes != null ? `${item.preparation_minutes} Min.` : '—'}`),
      element('p', `Vorbereitungszeit: ${item.thawing_minutes != null ? `${item.thawing_minutes} Min.` : ''}`),
      element('p', `Gewicht pro Packung: ${productWeightLabel(item)}`),
      element('p', `Ort: ${label(entry)}`));
    card.append(preview, info);
    loadStockPreview(item, preview, () => version === renderVersion);
    return card;
  };
  const content = groupCatalog(visible, (record) =>
    currentView === 'catalog' ? record : itemById.get(record.item_id), sorting?.categories).map((group, index) => {
      const section = element('section', undefined, 'category-group');
      const productCount = new Set(group.items.map((record) =>
        currentView === 'catalog' ? record.id : record.item_id)).size;
      const heading = element('h2', `${group.category || 'Ohne Kategorie'} (${productCount})`);
      heading.id = `category-${index}`;
      section.setAttribute('aria-labelledby', heading.id);
      const cards = element('div', undefined, 'grid');
      cards.append(...group.items.map(renderCard));
      section.append(heading, cards);
      return section;
    });
  document.querySelector('#items').replaceChildren(...content);
}

async function stockPreviewURL(itemId) {
  if (!previewPaths) {
    previewPaths = list('item_images', '?select=item_id,path&order=sort_order.asc,created_at.asc,id.asc')
      .then((images) => {
        const paths = new Map();
        for (const image of images) if (!paths.has(image.item_id)) paths.set(image.item_id, image.path);
        return paths;
      });
  }
  const request = previewPaths;
  let paths;
  try {
    paths = await request;
  } catch (error) {
    if (previewPaths === request) previewPaths = null;
    throw error;
  }
  const path = paths.get(itemId);
  if (!path) return null;
  let cached = previewURLs.get(path);
  if (!cached || cached.expiresAt <= Date.now()) {
    cached = { expiresAt: Date.now() + 100000, promise: imageURL(path) };
    previewURLs.set(path, cached);
  }
  try {
    return await cached.promise;
  } catch (error) {
    if (previewURLs.get(path) === cached) previewURLs.delete(path);
    throw error;
  }
}

export async function loadStockPreview(item, preview, isCurrent) {
  if (!isCurrent()) return;
  preview.textContent = offline ? 'Bild nur online verfügbar' : 'Bild wird geladen …';
  if (offline) return;
  try {
    const url = await stockPreviewURL(item.id);
    if (!isCurrent()) return;
    if (!url) {
      preview.textContent = 'Kein Bild';
      return;
    }
    const img = element('img');
    img.src = url;
    img.alt = item.name;
    img.loading = 'lazy';
    img.width = img.height = 96;
    img.addEventListener('error', () => {
      if (isCurrent()) preview.textContent = 'Bild konnte nicht geladen werden.';
    });
    preview.replaceChildren(img);
  } catch (error) {
    if (isCurrent()) preview.textContent = `Bild nicht verfügbar: ${error.message}`;
  }
}

function setView(view) {
  currentView = view;
  const title = view === 'catalog' ? 'Produktliste' : 'Bestand';
  document.querySelector('#view-title').textContent = title;
  document.title = `${title} · Eisfach`;
  document.querySelector('#stock-filter').hidden = view !== 'catalog';
  document.querySelector('#compact-view-control').hidden = view !== 'catalog';
  document.querySelector('#add-item').hidden = view !== 'catalog';
  for (const link of document.querySelectorAll('[data-navigation="stock"], [data-navigation="catalog"]')) {
    if (link.dataset.navigation === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  render();
}

async function editItem(item) {
  const version = ++editorImageVersion;
  editingItem = item || null;
  editingVersion = item?.updated_at || null;
  form().reset();
  for (const key of ['id', 'name', 'product_number', 'weight_grams', 'description', 'category', 'notes', 'preparation_minutes', 'thawing_minutes']) {
    form().elements[key].value = item?.[key] ?? '';
  }
  document.querySelector('#editor-title').textContent = item ? 'Produkt bearbeiten' : 'Produkt anlegen';
  document.querySelector('#editor-status').textContent = '';
  updateGoogleSearch();
  updateEditorActions();
  const gallery = document.querySelector('#editor-images');
  gallery.replaceChildren();
  dialog().showModal();
  if (!item) return;
  const isCurrent = () => version === editorImageVersion && dialog().open;
  try {
    await loadProductImages(item, gallery, isCurrent, editorAction);
  } catch (error) {
    if (isCurrent()) gallery.replaceChildren(element('p', `Bilder konnten nicht geladen werden: ${error.message}`));
  }
}

function updateGoogleSearch() {
  const link = document.querySelector('#google-search');
  const number = form().elements.product_number.value;
  const name = form().elements.name.value;
  const empty = !number.trim() && !name.trim();
  link.setAttribute('aria-disabled', String(empty));
  if (empty) link.removeAttribute('href');
  else link.href = productSearchURL(number, name);
}

function updateEditorActions() {
  form().querySelector('[type=submit]').disabled = editorBusy || offline;
  form().elements.image_url.readOnly = editorBusy || offline;
  document.querySelector('#cancel-item').disabled = editorBusy;
  const remove = document.querySelector('#delete-item');
  remove.hidden = !editingItem;
  remove.disabled = editorBusy || offline;
  document.querySelectorAll('#editor-images button').forEach((button) => {
    button.disabled = editorBusy || offline;
  });
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
    const body = Object.fromEntries(['name', 'product_number', 'description', 'category', 'notes']
      .map((key) => [key, fields[key].trim()]));
    body.preparation_minutes = optionalInteger(fields.preparation_minutes);
    body.thawing_minutes = optionalInteger(fields.thawing_minutes);
    body.weight_grams = optionalWeight(fields.weight_grams);
    if (!body.name) throw new Error('Ein Name ist erforderlich.');
    const urlImage = fields.image_url.trim() ? await loadImageURL(fields.image_url) : null;
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
    if (urlImage) {
      await uploadImage(id, urlImage, files.length);
      form().elements.image_url.value = '';
    }
    await refresh();
    if (stockDialog().open) {
      const product = items.find((item) => item.id === id);
      if (!product) throw new Error('Das Produkt wurde gespeichert, konnte aber nicht neu geladen werden. Bitte die Seite neu laden.');
      stockForm().elements.product_number_search.value = product.product_number;
      populateStockProducts(id);
    }
    dialog().close();
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
  stockEditingEntry = entry || null;
  stockEditingVersion = entry?.updated_at || null;
  stockForm().reset();
  stockForm().elements.id.value = entry?.id ?? '';
  populateStockProducts(entry?.item_id ?? itemId);
  stockForm().elements.location_id.replaceChildren(new Option('Bitte Ort auswählen', ''),
    ...locations.map((location) => new Option(location.name, location.id)));
  stockForm().elements.location_id.value = entry?.location_id ?? '';
  populateCompartments(stockForm().elements.compartment_id, compartments,
    stockForm().elements.location_id.value, entry?.compartment_id ?? '');
  stockForm().elements.quantity.value = entry?.quantity ?? 1;
  document.querySelector('#stock-title').textContent = entry ? 'Bestandsposition bearbeiten' : 'Bestand hinzufügen';
  document.querySelector('#stock-status').textContent = locations.length
    ? '' : 'Bitte zuerst unter Einstellungen → Orte und Fächer einen Ort anlegen.';
  updateStockActions();
  stockDialog().showModal();
}

function populateStockProducts(preferredId = stockForm().elements.item_id.value) {
  const products = filterByProductNumber(items, stockForm().elements.product_number_search.value);
  const select = stockForm().elements.item_id;
  select.replaceChildren(...products.map((item) =>
    new Option(`${item.product_number ? `${item.product_number} · ` : ''}${item.name}`, item.id)));
  if (!products.length) select.append(new Option('Keine passenden Produkte', ''));
  select.value = products.some((item) => item.id === preferredId) ? preferredId : products[0]?.id ?? '';
  updateStockProduct();
}

function updateStockProduct() {
  const product = items.find((item) => item.id === stockForm().elements.item_id.value);
  document.querySelector('#stock-product-weight').textContent = `Gewicht pro Packung: ${productWeightLabel(product)}`;
  updateStockActions();
}

function updateStockActions() {
  stockForm().querySelector('[type=submit]').disabled = stockBusy || offline || !stockForm().elements.item_id.value;
  document.querySelector('#cancel-stock').disabled = stockBusy;
  document.querySelector('#stock-new-item').disabled = stockBusy || offline;
  const quantity = Number(stockForm().elements.quantity.value);
  document.querySelector('#quantity-down').disabled = stockBusy || offline || quantity <= 0;
  document.querySelector('#quantity-up').disabled = stockBusy || offline || quantity >= 2147483647;
  const remove = document.querySelector('#delete-stock');
  remove.hidden = !stockEditingEntry;
  remove.disabled = stockBusy || offline;
}

async function saveStock(event) {
  event.preventDefault();
  stockBusy = true;
  updateStockActions();
  const feedback = document.querySelector('#stock-status');
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
    stockBusy = false;
    updateStockActions();
  }
}

async function deleteStock(entry) {
  if (offline) throw new Error('Offline sind keine Änderungen möglich.');
  if (!confirm('Diese Bestandsposition entfernen? Das Produkt bleibt im Katalog erhalten.')) return;
  const deleted = await rest('stock_entries',
    `?id=eq.${encodeURIComponent(entry.id)}&updated_at=eq.${encodeURIComponent(entry.updated_at)}`,
    { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  if (!deleted?.length) {
    await refresh();
    throw new Error('Position wurde zwischenzeitlich geändert oder entfernt. Bitte erneut versuchen.');
  }
  stockDialog().close();
  await refresh();
}

export async function loadProductImages(item, gallery, isCurrent, runAction = (handler) => handler()) {
  if (!isCurrent()) return;
  gallery.replaceChildren();
  if (offline) {
    gallery.append(element('p', 'Private Bilder sind nur online verfügbar.'));
    return;
  }
  const images = await list('item_images', `?item_id=eq.${item.id}&select=*&order=sort_order.asc,created_at.asc,id.asc`);
  if (!isCurrent()) return;
  for (const image of images) {
    const url = await imageURL(image.path);
    if (!isCurrent()) return;
    const figure = element('figure');
    const img = element('img');
    img.src = url;
    img.alt = image.caption || item.name;
    img.loading = 'lazy';
    const remove = action('Bild löschen', () => runAction(async () => {
      if (offline) throw new Error('Offline sind keine Änderungen möglich.');
      if (!confirm('Dieses Bild löschen?')) return;
      await removeImage(image);
      previewPaths = null;
      previewURLs.clear();
      figure.remove();
    }), 'danger');
    remove.disabled = offline || (gallery.id === 'editor-images' && editorBusy);
    figure.append(img, element('figcaption', image.caption || ''), remove);
    gallery.append(figure);
  }
  if (!images.length) gallery.append(element('p', 'Noch keine Bilder. Bilder unter „Bearbeiten“ hinzufügen.'));
}

export async function initInventory() {
  window.addEventListener('offline', () => {
    offline = true;
    document.querySelector('#add-item').disabled = true;
    updateEditorActions();
    updateStockActions();
    render();
  });
  const syncView = () => setView(location.hash === '#catalog' ? 'catalog' : 'stock');
  window.addEventListener('hashchange', syncView);
  syncView();
  document.querySelector('#search').addEventListener('input', render);
  document.querySelector('#only-with-stock').addEventListener('change', render);
  document.querySelector('#compact-view').addEventListener('change', render);
  document.querySelector('#add-item').addEventListener('click', () => editItem());
  for (const name of ['product_number', 'name']) {
    form().elements[name].addEventListener('input', updateGoogleSearch);
  }
  document.querySelector('#google-search').addEventListener('click', (event) => {
    try {
      event.currentTarget.href = productSearchURL(form().elements.product_number.value, form().elements.name.value);
    } catch (error) {
      event.preventDefault();
      document.querySelector('#editor-status').textContent = error.message;
    }
  });
  stockForm().elements.product_number_search.addEventListener('input', () => populateStockProducts());
  stockForm().elements.item_id.addEventListener('change', updateStockProduct);
  stockForm().elements.quantity.addEventListener('input', updateStockActions);
  for (const [id, step] of [['quantity-down', -1], ['quantity-up', 1]]) {
    document.querySelector(`#${id}`).addEventListener('click', () => {
      stockForm().elements.quantity.stepUp(step);
      updateStockActions();
    });
  }
  document.querySelector('#stock-new-item').addEventListener('click', async () => {
    try {
      await editItem();
      form().elements.product_number.value = stockForm().elements.product_number_search.value.trim();
    } catch (error) {
      document.querySelector('#stock-status').textContent = error.message;
    }
  });
  document.querySelector('#cancel-item').addEventListener('click', () => dialog().close());
  document.querySelector('#delete-item').addEventListener('click', () =>
    editorAction(() => deleteItem(editingItem)));
  document.querySelector('#cancel-stock').addEventListener('click', () => stockDialog().close());
  document.querySelector('#delete-stock').addEventListener('click', async () => {
    stockBusy = true;
    updateStockActions();
    try {
      await deleteStock(stockEditingEntry);
    } catch (error) {
      if (stockDialog().open) document.querySelector('#stock-status').textContent = error.message;
      else status(error.message);
    } finally {
      stockBusy = false;
      updateStockActions();
    }
  });
  dialog().addEventListener('cancel', (event) => {
    if (editorBusy) event.preventDefault();
  });
  dialog().addEventListener('close', () => {
    editorImageVersion++;
    document.querySelector('#editor-images').replaceChildren();
  });
  stockDialog().addEventListener('cancel', (event) => {
    if (stockBusy) event.preventDefault();
  });
  form().addEventListener('submit', saveItem);
  stockForm().addEventListener('submit', saveStock);
  stockForm().elements.location_id.addEventListener('change', () => {
    populateCompartments(stockForm().elements.compartment_id, compartments,
      stockForm().elements.location_id.value);
  });
  await refresh();
}
