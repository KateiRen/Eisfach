import { rest, list } from './supabase.js';
import { loadConnection, saveSnapshot, loadSnapshot } from './auth.js';
import { imageURL } from './storage.js';
import { element, action, status } from './app.js';
import { locationLabel, populateCompartments, locationSelection } from './locations.js';
import { loadSorting, compareOrder, orderRecords, orderStockPositions } from './ordering.js';
import { productDetails, thawingTimeLabel, optionalInteger, optionalWeight, priceLabel } from './product.js';
import { reorderProduct, receiveOrder } from './orders.js';
import { initProductEditor, editItem, updateEditorActions } from './product-editor.js';

export { optionalInteger, optionalWeight } from './product.js';
export { loadProductImages } from './product-editor.js';

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
let previewObserver = null;
const previewURLs = new Map();
let stockEditingVersion = null;
let stockEditingEntry = null;
let stockBusy = false;
let stockImageVersion = 0;
let stockAction = null;
let stockCreatingId = null;
let receivingOrder = null;
let returnToOrders = false;
const dialog = () => document.querySelector('#item-dialog');
const stockForm = () => document.querySelector('#stock-form');
const stockDialog = () => document.querySelector('#stock-dialog');
const stockActionForm = () => document.querySelector('#stock-action-form');
const stockActionDialog = () => document.querySelector('#stock-action-dialog');

export function hasStock(entry) {
  return Number(entry.quantity) > 0;
}

export function matchesProduct(item, search, category, locationNames = []) {
  const query = search.toLocaleLowerCase('de');
  return (!category || item.category === category) &&
    [item.name, item.product_number, item.parts, item.description, item.category, item.notes, item.qr_code, ...locationNames]
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
  const parts = productDetails(item).parts || '—';
  return { parts, weight: productWeightLabel(item) };
}

export function stockTimeLabels(item = {}) {
  return {
    preparation: item.preparation_minutes == null ? '' : `Zubereitungszeit: ${item.preparation_minutes} Min.`,
    thawing: item.thawing_minutes == null ? '' : `Auftauzeit: ${thawingTimeLabel(item.thawing_minutes)}`,
  };
}

export function stockCardLabels(item = {}) {
  const times = stockTimeLabels(item);
  return [
    Number(item.preparation_minutes) > 0 ? times.preparation : '',
    times.thawing,
    Number(item.weight_grams) > 0 ? `Gewicht pro Packung: ${productWeightLabel(item)}` : '',
  ].filter(Boolean);
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

export function stockValues(fields) {
  const quantity = Number(fields.quantity);
  if (fields.quantity === '' || !Number.isInteger(quantity) || quantity < 0 || quantity > 2147483647) {
    throw new Error('Bitte eine gültige nichtnegative ganze Stückzahl eingeben.');
  }
  return { quantity };
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
  previewObserver?.disconnect();
  previewObserver = null;
  const previews = [];
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
        row.append(element('span', item.name, 'compact-name'), element('span', priceLabel(item.price)));
        const links = element('div', undefined, 'compact-actions');
        const edit = action('Bearbeiten', () => editItem(item), 'text-link');
        const add = action('Einlagern', () => editStock(null, item.id), 'text-link');
        const reorder = action('Nachbestellen', () => reorderItem(item), 'text-link');
        edit.disabled = add.disabled = reorder.disabled = offline;
        edit.setAttribute('aria-label', `Bearbeiten: ${item.name}`);
        add.setAttribute('aria-label', `Einlagern: ${item.name}`);
        reorder.setAttribute('aria-label', `Nachbestellen: ${item.name}`);
        links.append(edit, add, reorder);
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
        element('p', `Preis pro Packung: ${priceLabel(item.price)}`),
        element('p', productStockLabel(item.id, stockEntries)));
      appendProductDetails(info, item);
      const buttons = element('div', undefined, 'actions compact-actions');
      const edit = action('Bearbeiten', () => editItem(item));
      const add = action('Einlagern', () => editStock(null, item.id));
      const reorder = action('Nachbestellen', () => reorderItem(item));
      edit.disabled = add.disabled = reorder.disabled = offline;
      buttons.append(edit, add, reorder);
      info.append(buttons);
      card.append(preview, info);
      previews.push({ item, preview });
      preview.textContent = offline ? 'Bild nur online verfügbar' : 'Bild wird nachgeladen …';
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
      ...stockCardLabels(item).map((text) => element('p', text)),
      element('p', `Ort: ${label(entry)}`));
    card.append(preview, info);
    previews.push({ item, preview });
    preview.textContent = offline ? 'Bild nur online verfügbar' : 'Bild wird nachgeladen …';
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
  scheduleStockPreviews(previews, () => version === renderVersion);
}

function appendProductDetails(container, item, stock = false) {
  const details = productDetails(item);
  if (stock) {
    if (details.parts?.trim()) container.append(element('p', `Teile: ${details.parts}`));
    const labels = [];
    if (details.favorite) labels.push('Favorit: Ja');
    if (details.rating !== null) labels.push(`Rating: ${details.rating}/5`);
    if (labels.length) container.append(element('p', labels.join(' · '), 'muted'));
  } else {
    const favorite = details.favorite === null ? '—' : details.favorite ? 'Ja' : 'Nein';
    container.append(element('p', `Favorit: ${favorite} · Rating: ${details.rating === null ? '—' : `${details.rating}/5`}`, 'muted'),
      element('p', `Nutzungscounter: ${details.usage_count}`, 'muted'));
  }

  if (details.product_url) {
    const link = element('a', 'Produktseite');
    link.href = details.product_url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    container.append(link);
  }
}

async function reorderItem(item) {
  if (offline || !navigator.onLine) throw new Error('Nachbestellen benötigt eine Internetverbindung.');
  const entry = await reorderProduct(item.id);
  status(`„${item.name}“ steht mit ${entry.quantity} Stück auf der Bestellliste.`);
}

export function scheduleStockPreviews(previews, isCurrent) {
  if (!previews.length || offline) return;
  // Yield through a paint before starting image metadata and signed-URL requests.
  requestAnimationFrame(() => setTimeout(() => {
    if (!isCurrent()) return;
    if (!('IntersectionObserver' in globalThis)) {
      for (const { item, preview } of previews) loadStockPreview(item, preview, isCurrent, 96, currentView === 'stock');
      return;
    }
    const products = new Map(previews.map(({ item, preview }) => [preview, item]));
    const observer = new IntersectionObserver((entries) => {
      if (!isCurrent()) { observer.disconnect(); return; }
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        loadStockPreview(products.get(entry.target), entry.target, isCurrent, 96, currentView === 'stock');
      }
    });
    previewObserver = observer;
    for (const { preview } of previews) observer.observe(preview);
  }, 0));
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

function showStockImage(url, name) {
  const viewer = element('dialog', undefined, 'stock-image-viewer');
  viewer.setAttribute('aria-label', `Bild: ${name}`);
  const close = element('button', undefined, 'stock-image-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Bildansicht schließen');
  const img = element('img');
  img.src = url;
  img.alt = name;
  close.append(img);
  viewer.append(close);
  viewer.addEventListener('click', () => viewer.close());
  viewer.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    viewer.close();
  });
  viewer.addEventListener('close', () => viewer.remove(), { once: true });
  document.body.append(viewer);
  viewer.showModal();
}

export async function loadStockPreview(item, preview, isCurrent, size = 96, zoomable = false) {
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
    img.width = img.height = size;
    img.addEventListener('error', () => {
      if (isCurrent()) preview.textContent = 'Bild konnte nicht geladen werden.';
    });
    if (zoomable) {
      const zoom = element('button', undefined, 'stock-image-zoom');
      zoom.type = 'button';
      zoom.setAttribute('aria-label', `Bild vergrößern: ${item.name}`);
      zoom.addEventListener('click', () => showStockImage(url, item.name));
      zoom.append(img);
      preview.replaceChildren(zoom);
    } else {
      preview.replaceChildren(img);
    }
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

function editStock(entry, itemId) {
  stockEditingEntry = entry || null;
  stockEditingVersion = entry?.updated_at || null;
  stockCreatingId = entry ? null : crypto.randomUUID();
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
  updateStockProduct();
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
  const editing = Boolean(stockEditingEntry);
  const receiving = Boolean(receivingOrder);
  document.querySelector('#stock-product-picker').hidden = editing || receiving;
  document.querySelector('#stock-product-details').hidden = !editing && !receiving;
  document.querySelector('#stock-location-picker').hidden = editing;
  document.querySelector('#stock-current-location').hidden = !editing;
  document.querySelector('#stock-position-actions').hidden = !editing;
  document.querySelector('#stock-quantity-label').textContent = editing ? 'Stückzahl dieser Position' : 'Stückzahl';
  document.querySelector('#stock-title').textContent = editing ? product?.name || 'Produkt nicht verfügbar' : 'Bestand hinzufügen';
  stockForm().elements.quantity.min = receiving ? '1' : '0';
  stockForm().elements.quantity.max = receiving ? String(receivingOrder.quantity) : '2147483647';
  if (receiving) document.querySelector('#stock-title').textContent = `Einlagern: ${product?.name || 'Produkt nicht verfügbar'}`;
  if (editing || receiving) {
    document.querySelector('#stock-subtitle').textContent = `Produktnummer: ${product?.product_number || '—'}`;
    if (receiving) document.querySelector('#stock-subtitle').textContent += ` · Offen: ${receivingOrder.quantity} Stück`;
    document.querySelector('#stock-description').textContent = product?.description || 'Keine Beschreibung vorhanden.';
    for (const [name, text] of Object.entries(stockTimeLabels(product))) {
      const field = document.querySelector(`#stock-${name}`);
      field.textContent = text;
      field.hidden = !text;
    }
    const metadata = document.querySelector('#stock-product-metadata');
    metadata.replaceChildren();
    appendProductDetails(metadata, product || {}, true);
    if (editing) updateStockLocation();
    const version = ++stockImageVersion;
    const preview = document.querySelector('#stock-detail-image');
    preview.replaceChildren();
    if (product && stockDialog().open) {
      loadStockPreview(product, preview, () => version === stockImageVersion && stockDialog().open, 192, true);
    }
  }
  document.querySelector('#stock-product-weight').textContent = `Gewicht pro Packung: ${productWeightLabel(product)}`;
  updateStockActions();
}

function updateStockLocation() {
  document.querySelector('#stock-current-location').textContent =
    `Aktueller Ort: ${locationLabel(stockEditingEntry, locations, compartments) || 'Nicht verfügbar'}`;
}

function updateStockActions() {
  stockForm().querySelector('[type=submit]').disabled = stockBusy || offline || !stockForm().elements.item_id.value;
  document.querySelector('#cancel-stock').disabled = stockBusy;
  document.querySelector('#stock-new-item').disabled = stockBusy || offline;
  const quantity = Number(stockForm().elements.quantity.value);
  document.querySelector('#quantity-down').disabled = stockBusy || offline || quantity <= Number(stockForm().elements.quantity.min);
  document.querySelector('#quantity-up').disabled = stockBusy || offline || quantity >= Number(stockForm().elements.quantity.max);
  const remove = document.querySelector('#delete-stock');
  remove.hidden = !stockEditingEntry;
  remove.disabled = stockBusy || offline;
  for (const id of ['relocate-stock', 'additional-stock']) {
    document.querySelector(`#${id}`).disabled = stockBusy || offline || !stockEditingEntry;
  }
  stockForm().elements.quantity.readOnly = stockBusy || offline;
  stockActionForm().querySelector('[type=submit]').disabled = stockBusy || offline;
  document.querySelector('#cancel-stock-action').disabled = stockBusy;
  const additionalQuantity = Number(stockActionForm().elements.quantity.value);
  document.querySelector('#stock-action-down').disabled = stockBusy || offline || additionalQuantity <= 1;
  document.querySelector('#stock-action-up').disabled = stockBusy || offline || additionalQuantity >= 2147483647;
  stockActionForm().elements.quantity.readOnly = stockBusy || offline;
}

function openStockAction(mode) {
  if (offline || stockBusy || !stockEditingEntry) throw new Error('Diese Aktion benötigt eine verfügbare Bestandsposition und Internet.');
  stockAction = { mode, id: crypto.randomUUID() };
  stockActionForm().reset();
  const moving = mode === 'move';
  document.querySelector('#stock-action-title').textContent = moving ? 'Umlagern' : 'Weiteren Bestand erfassen';
  document.querySelector('#stock-action-info').textContent = moving
    ? `Die gesamte gespeicherte Position (${stockEditingEntry.quantity} Stück) wird umgelagert. Eine ungespeicherte Mengenänderung bleibt im Hauptdialog erhalten.`
    : 'Erfasst eine neue Position für dasselbe Produkt. Die aktuelle Position bleibt unverändert.';
  document.querySelector('#stock-action-quantity-control').hidden = moving;
  stockActionForm().elements.quantity.disabled = moving;
  stockActionForm().elements.location_id.replaceChildren(new Option('Bitte Ort auswählen', ''),
    ...locations.map((location) => new Option(location.name, location.id)));
  stockActionForm().elements.location_id.value = stockEditingEntry.location_id;
  populateCompartments(stockActionForm().elements.compartment_id, compartments,
    stockEditingEntry.location_id, stockEditingEntry.compartment_id ?? '');
  document.querySelector('#stock-action-status').textContent = '';
  updateStockActions();
  stockActionDialog().showModal();
}

export async function createAdditionalPosition(body) {
  const saved = await rest('rpc/create_stock_position', '', {
    method: 'POST', body: {
      p_id: body.id, p_item_id: body.item_id, p_location_id: body.location_id,
      p_compartment_id: body.compartment_id, p_quantity: body.quantity,
    },
  });
  if (!saved?.length) throw new Error('Die zusätzliche Position konnte nicht bestätigt werden. Bitte erneut versuchen.');
  return saved[0];
}

async function saveStockAction(event) {
  event.preventDefault();
  if (stockBusy) return;
  const fields = Object.fromEntries(new FormData(stockActionForm()));
  stockBusy = true;
  updateStockActions();
  const feedback = document.querySelector('#stock-action-status');
  feedback.textContent = 'Wird gespeichert …';
  let savedSuccessfully = false;
  try {
    if (offline) throw new Error('Offline sind keine Änderungen möglich.');
    const target = locationSelection(fields, locations, compartments);
    if (stockAction.mode === 'move') {
      const saved = await rest('stock_entries',
        `?id=eq.${stockEditingEntry.id}&updated_at=eq.${encodeURIComponent(stockEditingVersion)}`, {
          method: 'PATCH', body: target, headers: { Prefer: 'return=representation' },
        });
      if (!saved?.length) throw new Error('Position wurde zwischenzeitlich geändert oder entfernt. Bitte schließen und erneut öffnen.');
      stockEditingEntry = saved[0];
      stockEditingVersion = saved[0].updated_at;
      stockForm().elements.location_id.value = saved[0].location_id;
      populateCompartments(stockForm().elements.compartment_id, compartments,
        saved[0].location_id, saved[0].compartment_id ?? '');
      updateStockLocation();
    } else {
      const values = stockValues(fields);
      if (values.quantity < 1) throw new Error('Bitte mindestens ein Stück erfassen.');
      await createAdditionalPosition({
        id: stockAction.id, inventory_id: loadConnection().inventoryId,
        item_id: stockEditingEntry.item_id, ...target, ...values,
      });
    }
    savedSuccessfully = true;
    stockActionDialog().close();
    document.querySelector('#stock-status').textContent = stockAction.mode === 'move'
      ? 'Position umgelagert. Ungespeicherte Stückzahländerungen bitte mit Speichern übernehmen.'
      : 'Zusätzliche Bestandsposition gespeichert.';
    await refresh();
    updateStockProduct();
  } catch (error) {
    if (savedSuccessfully) document.querySelector('#stock-status').textContent = `Gespeichert, aber die Liste konnte nicht aktualisiert werden: ${error.message}`;
    else feedback.textContent = error.message;
  } finally {
    stockBusy = false;
    updateStockActions();
  }
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
    const creating = !fields.id;
    const body = creating ? { item_id: fields.item_id,
      ...locationSelection(fields, locations, compartments), ...stockValues(fields) } : stockValues(fields);
    if (creating) body.inventory_id = loadConnection().inventoryId;
    const filter = creating ? '' : `?id=eq.${encodeURIComponent(fields.id)}&updated_at=eq.${encodeURIComponent(stockEditingVersion)}`;
    const saved = creating
      ? [await (receivingOrder
        ? receiveOrder(receivingOrder, { ...body, id: stockCreatingId })
        : createAdditionalPosition({ ...body, id: stockCreatingId }))]
      : await rest('stock_entries', filter, {
        method: 'PATCH', body, headers: { Prefer: 'return=representation' },
      });
    if (!saved?.length) {
      await refresh();
      throw new Error('Position wurde zwischenzeitlich geändert oder entfernt. Bitte schließen und erneut öffnen.');
    }
    stockDialog().close();
    if (!returnToOrders) await refresh();
  } catch (error) {
    if (stockDialog().open) feedback.textContent = error.message;
    else status(`Gespeichert, aber die Liste konnte nicht aktualisiert werden: ${error.message}`);
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

export async function initInventory() {
  initProductEditor({
    isOffline: () => offline,
    onChange: async (saved) => {
      await refresh();
      if (saved && stockDialog().open) {
        const product = items.find((item) => item.id === saved.id);
        if (!product) throw new Error('Das Produkt wurde gespeichert, konnte aber nicht neu geladen werden. Bitte die Seite neu laden.');
        stockForm().elements.product_number_search.value = product.product_number;
        populateStockProducts(product.id);
      }
    },
    onImagesChanged: () => {
      previewPaths = null;
      previewURLs.clear();
    },
  });
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
  stockForm().elements.product_number_search.addEventListener('input', () => populateStockProducts());
  stockForm().elements.item_id.addEventListener('change', updateStockProduct);
  stockForm().elements.quantity.addEventListener('input', updateStockActions);
  stockActionForm().elements.quantity.addEventListener('input', updateStockActions);
  for (const [id, step] of [['quantity-down', -1], ['quantity-up', 1]]) {
    document.querySelector(`#${id}`).addEventListener('click', () => {
      stockForm().elements.quantity.stepUp(step);
      updateStockActions();
    });
  }
  for (const [id, step] of [['stock-action-down', -1], ['stock-action-up', 1]]) {
    document.querySelector(`#${id}`).addEventListener('click', () => {
      stockActionForm().elements.quantity.stepUp(step);
      updateStockActions();
    });
  }
  for (const [id, mode] of [['relocate-stock', 'move'], ['additional-stock', 'add']]) {
    document.querySelector(`#${id}`).addEventListener('click', () => {
      try { openStockAction(mode); }
      catch (error) { document.querySelector('#stock-status').textContent = error.message; }
    });
  }
  document.querySelector('#cancel-stock-action').addEventListener('click', () => stockActionDialog().close());
  stockActionForm().addEventListener('submit', saveStockAction);
  stockActionForm().elements.location_id.addEventListener('change', () => {
    populateCompartments(stockActionForm().elements.compartment_id, compartments,
      stockActionForm().elements.location_id.value);
  });
  document.querySelector('#stock-new-item').addEventListener('click', async () => {
    try {
      await editItem(null, stockForm().elements.product_number_search.value.trim());
    } catch (error) {
      document.querySelector('#stock-status').textContent = error.message;
    }
  });
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
  dialog().addEventListener('close', () => {
    if (returnToOrders) location.assign('./orders.html');
  });
  stockDialog().addEventListener('cancel', (event) => {
    if (stockBusy) event.preventDefault();
  });
  stockDialog().addEventListener('close', () => {
    stockImageVersion++;
    document.querySelector('#stock-detail-image').replaceChildren();
    if (returnToOrders) location.assign('./orders.html');
  });
  stockActionDialog().addEventListener('cancel', (event) => {
    if (stockBusy) event.preventDefault();
  });
  stockForm().addEventListener('submit', saveStock);
  stockForm().elements.location_id.addEventListener('change', () => {
    populateCompartments(stockForm().elements.compartment_id, compartments,
      stockForm().elements.location_id.value);
  });
  await refresh();
  const parameters = new URLSearchParams(location.search);
  const productId = parameters.get('edit-product');
  const orderId = parameters.get('receive-order');
  if (productId || orderId) {
    if (offline) throw new Error('Diese Aktion benötigt eine Internetverbindung. Bitte zur Bestellliste zurückkehren.');
    if (orderId) {
      const entries = await rest('order_entries', `?id=eq.${encodeURIComponent(orderId)}&select=*`);
      const entry = entries?.[0];
      if (!entry || !items.some((item) => item.id === entry.item_id)) {
        throw new Error('Bestelleintrag nicht mehr verfügbar. Bitte zur Bestellliste zurückkehren und aktualisieren.');
      }
      receivingOrder = entry;
      returnToOrders = true;
      editStock(null, entry.item_id);
      stockForm().elements.quantity.value = entry.quantity;
      updateStockActions();
    } else {
      const item = items.find((item) => item.id === productId);
      if (!item) throw new Error('Produkt nicht mehr verfügbar. Bitte zur Bestellliste zurückkehren und aktualisieren.');
      returnToOrders = true;
      await editItem(item);
    }
  }
}
