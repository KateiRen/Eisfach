import { rest, list } from './supabase.js';
import { loadConnection } from './auth.js';
import { uploadImage, imageURL, removeImage } from './storage.js';
import { element, action, status } from './app.js';
import { productDetails, productNumberSearch, optionalInteger, optionalWeight, optionalPrice } from './product.js';

let editingVersion = null;
let editingItem = null;
let editorBusy = false;
let editorImageVersion = 0;
let isOffline = () => false;
let onChange;
let onImagesChanged = () => {};
const form = () => document.querySelector('#item-form');
const dialog = () => document.querySelector('#item-dialog');

export function initProductEditor(options) {
  isOffline = options.isOffline;
  onChange = options.onChange;
  onImagesChanged = options.onImagesChanged ?? (() => {});
  document.querySelector('main').insertAdjacentHTML('beforeend', `
    <dialog id="item-dialog" aria-labelledby="editor-title">
      <form id="item-form">
        <h2 id="editor-title">Produkt anlegen</h2>
        <input name="id" type="hidden">
        <label>Name<input name="name" required maxlength="200"></label>
        <label>Produktnummer<input name="product_number" maxlength="100"></label>
        <p id="item-number-search" hidden><a class="button secondary" target="_blank" rel="noopener noreferrer"></a></p>
        <label>Kategorie<input name="category" maxlength="100" list="categories"></label>
        <datalist id="categories"></datalist>
        <label>Produktseite (optional)<input name="product_url" type="url" placeholder="https://…"></label>
        <label>Preis pro Packung (Euro, optional)<input name="price" type="text" inputmode="decimal" placeholder="z. B. 4,99"></label>
        <div class="columns product-pack-fields">
          <label>Gewicht pro Packung (g, optional)<input name="weight_grams" type="number" min="0" max="999999999.999" step="0.001"></label>
          <label>Teile (optional)<input name="parts" type="text"></label>
        </div>
        <label>Beschreibung<textarea name="description" maxlength="2000"></textarea></label>
        <label class="checkbox-label"><input name="favorite" type="checkbox"> Favorit</label>
        <fieldset class="product-rating">
          <legend>Rating (optional, 0–5)</legend>
          <div class="rating-stars">
            <label><input name="rating" type="radio" value="1" aria-label="1 Stern"><span aria-hidden="true">★</span></label>
            <label><input name="rating" type="radio" value="2" aria-label="2 Sterne"><span aria-hidden="true">★</span></label>
            <label><input name="rating" type="radio" value="3" aria-label="3 Sterne"><span aria-hidden="true">★</span></label>
            <label><input name="rating" type="radio" value="4" aria-label="4 Sterne"><span aria-hidden="true">★</span></label>
            <label><input name="rating" type="radio" value="5" aria-label="5 Sterne"><span aria-hidden="true">★</span></label>
          </div>
          <div class="rating-options">
            <label class="checkbox-label"><input name="rating" type="radio" value="0"> 0 Sterne</label>
            <label class="checkbox-label"><input name="rating" type="radio" value="" checked> Keine Bewertung</label>
          </div>
        </fieldset>
        <p>Nutzungscounter: <output id="item-usage-count">0</output></p>
        <div class="columns">
          <label>Zubereitungszeit (Minuten)<input name="preparation_minutes" type="number" min="0" max="2147483647" step="1"></label>
          <label>Auftauzeit (Minuten, optional)<input name="thawing_minutes" type="number" min="0" max="2147483647" step="1"></label>
        </div>
        <label>Notizen<textarea name="notes" maxlength="4000"></textarea></label>
        <div id="editor-images" class="images" aria-label="Vorhandene Produktbilder"></div>
        <label>Bilder hinzufügen<input name="images" type="file" accept="image/*" multiple></label>
        <p>Bilder werden auf maximal 1600 Pixel verkleinert und als WebP gespeichert.</p>
        <p id="editor-status" role="status"></p>
        <div class="actions">
          <button id="delete-item" type="button" class="danger" hidden>Produkt löschen</button>
          <button type="submit">Speichern</button>
          <button id="cancel-item" type="button" class="secondary">Schließen</button>
        </div>
      </form>
    </dialog>
  `);
  document.querySelector('#cancel-item').addEventListener('click', () => dialog().close());
  document.querySelector('#delete-item').addEventListener('click', () =>
    editorAction(() => deleteItem(editingItem)));
  dialog().addEventListener('cancel', (event) => {
    if (editorBusy) event.preventDefault();
  });
  dialog().addEventListener('close', () => {
    editorImageVersion++;
    document.querySelector('#editor-images').replaceChildren();
  });
  form().addEventListener('submit', saveItem);
  form().elements.product_number.addEventListener('input', updateProductNumberSearch);
}

function updateProductNumberSearch() {
  const search = productNumberSearch(form().elements.product_number.value);
  const container = document.querySelector('#item-number-search');
  const link = container.querySelector('a');
  container.hidden = !search;
  if (search) {
    link.textContent = search.label;
    link.href = search.href;
  } else {
    link.textContent = '';
    link.removeAttribute('href');
  }
}

export async function editItem(item, productNumber = '') {
  const version = ++editorImageVersion;
  editingItem = item || null;
  editingVersion = item?.updated_at || null;
  form().reset();
  for (const key of ['id', 'name', 'product_number', 'price', 'weight_grams', 'description', 'category', 'notes', 'preparation_minutes', 'thawing_minutes']) {
    form().elements[key].value = item?.[key] ?? '';
  }
  if (!item) form().elements.product_number.value = productNumber;
  updateProductNumberSearch();
  const details = productDetails(item || {});
  form().elements.product_url.value = details.product_url ?? '';
  form().elements.parts.value = details.parts ?? '';
  form().elements.favorite.checked = details.favorite === true;
  form().elements.rating.value = details.rating ?? '';
  document.querySelector('#item-usage-count').textContent = String(details.usage_count);
  document.querySelector('#editor-title').textContent = item ? 'Produkt bearbeiten' : 'Produkt anlegen';
  document.querySelector('#editor-status').textContent = '';
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

export function updateEditorActions() {
  form().querySelector('[type=submit]').disabled = editorBusy || isOffline();
  document.querySelector('#cancel-item').disabled = editorBusy;
  const remove = document.querySelector('#delete-item');
  remove.hidden = !editingItem;
  remove.disabled = editorBusy || isOffline();
  document.querySelectorAll('#editor-images button').forEach((button) => {
    button.disabled = editorBusy || isOffline();
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
  if (editorBusy) return;
  editorBusy = true;
  updateEditorActions();
  const feedback = document.querySelector('#editor-status');
  feedback.textContent = 'Wird gespeichert …';
  try {
    if (isOffline()) throw new Error('Offline sind keine Änderungen möglich.');
    const fields = Object.fromEntries(new FormData(form()));
    const id = fields.id || crypto.randomUUID();
    const creating = !fields.id;
    const body = Object.fromEntries(['name', 'product_number', 'description', 'category', 'notes']
      .map((key) => [key, fields[key].trim()]));
    body.preparation_minutes = optionalInteger(fields.preparation_minutes);
    body.thawing_minutes = optionalInteger(fields.thawing_minutes);
    body.weight_grams = optionalWeight(fields.weight_grams);
    body.price = optionalPrice(fields.price);
    const details = productDetails({
      product_url: fields.product_url.trim(), parts: fields.parts.trim() || null,
      favorite: form().elements.favorite.checked,
      rating: fields.rating === '' ? null : Number(fields.rating),
    });
    const { usage_count, ...editableDetails } = details;
    Object.assign(body, editableDetails);
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
      await onChange(null);
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
    await onChange(saved[0]);
    dialog().close();
  } catch (error) {
    feedback.textContent = `${error.message} Bereits gespeicherte Artikeldaten bleiben erhalten; bei teilweisem Bildupload bitte schließen und Bilder prüfen.`;
  } finally {
    editorBusy = false;
    updateEditorActions();
  }
}

async function deleteItem(item) {
  if (isOffline()) throw new Error('Offline sind keine Änderungen möglich.');
  if (!confirm(`Produkt „${item.name}“ unwiderruflich löschen? Alle zugehörigen Bestandspositionen, Bestelllisteneinträge und Bilder werden ebenfalls gelöscht.`)) return;
  const images = await list('item_images', `?item_id=eq.${item.id}&select=*&order=id.asc`);
  // Objekte vor dem Artikel löschen, solange die Storage-Policy dessen Existenz prüfen kann.
  for (const image of images) await removeImage(image);
  await rest('items', `?id=eq.${item.id}`, { method: 'DELETE' });
  dialog().close();
  await onChange(null);
}

export async function loadProductImages(item, gallery, isCurrent, runAction = (handler) => handler()) {
  if (!isCurrent()) return;
  gallery.replaceChildren();
  if (isOffline()) {
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
      if (isOffline()) throw new Error('Offline sind keine Änderungen möglich.');
      if (!confirm('Dieses Bild löschen?')) return;
      await removeImage(image);
      onImagesChanged();
      figure.remove();
    }), 'danger');
    remove.disabled = isOffline() || (gallery.id === 'editor-images' && editorBusy);
    figure.append(img, remove);
    gallery.append(figure);
  }
  if (!images.length) gallery.append(element('p', 'Noch keine Bilder. Bilder unter „Bearbeiten“ hinzufügen.'));
}
