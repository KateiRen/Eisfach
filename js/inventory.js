import { rest, list } from './supabase.js';
import { loadConnection, saveSnapshot, loadSnapshot } from './auth.js';
import { uploadImage, imageURL, removeImage } from './storage.js';
import { renderQR, scanQR } from './scanner.js';
import { element, action, status } from './app.js';

let items = [];
let offline = false;
let detailVersion = 0;
let editingVersion = null;
const form = () => document.querySelector('#item-form');
const dialog = () => document.querySelector('#item-dialog');

async function refresh() {
  try {
    items = await list('items', '?select=*&order=name.asc,id.asc');
    offline = false;
    saveSnapshot(items);
    status('');
  } catch (error) {
    const snapshot = loadSnapshot();
    if (!snapshot) throw error;
    items = snapshot.items;
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
  render();
}

function render() {
  const search = document.querySelector('#search').value.toLocaleLowerCase('de');
  const category = document.querySelector('#category').value;
  const visible = items.filter((item) =>
    (!category || item.category === category) &&
    [item.name, item.description, item.category, item.location, item.notes, item.qr_code]
      .some((value) => String(value || '').toLocaleLowerCase('de').includes(search)));
  document.querySelector('#empty').hidden = visible.length > 0;
  document.querySelector('#items').replaceChildren(...visible.map((item) => {
    const card = element('article', undefined, 'card');
    card.append(element('h2', item.name), element('p', item.description || ''),
      element('p', [item.category, item.location].filter(Boolean).join(' · '), 'muted'));
    if (item.notes) card.append(element('p', item.notes));
    const quantity = element('div', undefined, 'actions');
    quantity.append(action('−', () => changeQuantity(item, -1)), element('span', String(item.quantity), 'quantity'),
      action('+', () => changeQuantity(item, 1)));
    quantity.firstChild.setAttribute('aria-label', `Menge von ${item.name} verringern`);
    quantity.lastChild.setAttribute('aria-label', `Menge von ${item.name} erhöhen`);
    quantity.firstChild.disabled = offline || item.quantity <= 0;
    quantity.lastChild.disabled = offline || item.quantity >= 2147483647;
    const buttons = element('div', undefined, 'actions');
    const edit = action('Bearbeiten', () => editItem(item));
    const remove = action('Löschen', () => deleteItem(item), 'danger');
    edit.disabled = remove.disabled = offline;
    buttons.append(edit, action('Bilder & QR', () => showDetails(item)), remove);
    card.append(quantity, document.createElement('hr'), buttons);
    return card;
  }));
}

async function changeQuantity(item, delta) {
  const quantity = item.quantity + delta;
  // Vergleich verhindert, dass gleichzeitige Änderungen unbemerkt überschrieben werden.
  const updated = await rest('items', `?id=eq.${item.id}&quantity=eq.${item.quantity}`, {
    method: 'PATCH', body: { quantity }, headers: { Prefer: 'return=representation' },
  });
  await refresh();
  if (!updated.length) status('Die Menge wurde zwischenzeitlich geändert. Bitte erneut versuchen.');
}

function editItem(item) {
  editingVersion = item?.updated_at || null;
  form().reset();
  for (const key of ['id', 'name', 'description', 'quantity', 'category', 'location', 'notes']) {
    form().elements[key].value = item?.[key] ?? (key === 'quantity' ? 1 : '');
  }
  document.querySelector('#editor-title').textContent = item ? 'Artikel bearbeiten' : 'Artikel anlegen';
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
    const fields = Object.fromEntries(new FormData(form()));
    const id = fields.id || crypto.randomUUID();
    const creating = !fields.id;
    const body = Object.fromEntries(['name', 'description', 'category', 'location', 'notes']
      .map((key) => [key, fields[key].trim()]));
    body.quantity = Number(fields.quantity);
    if (!body.name || !Number.isInteger(body.quantity) || body.quantity < 0 || body.quantity > 2147483647) {
      throw new Error('Name und eine gültige, nichtnegative ganze Menge sind erforderlich.');
    }
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
  if (!confirm(`„${item.name}“ mit allen Bildern unwiderruflich löschen?`)) return;
  const images = await list('item_images', `?item_id=eq.${item.id}&select=*&order=id.asc`);
  // Objekte vor dem Artikel löschen, solange die Storage-Policy dessen Existenz prüfen kann.
  for (const image of images) await removeImage(image);
  await rest('items', `?id=eq.${item.id}`, { method: 'DELETE' });
  await refresh();
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
      if (!confirm('Dieses Bild löschen?')) return;
      await removeImage(image);
      figure.remove();
    }, 'danger');
    figure.append(img, element('figcaption', image.caption || ''), remove);
    gallery.append(figure);
  }
  if (!images.length) gallery.append(element('p', 'Noch keine Bilder. Bilder unter „Bearbeiten“ hinzufügen.'));
}

export async function initInventory() {
  window.addEventListener('offline', () => {
    offline = true;
    document.querySelector('#add-item').disabled = true;
    render();
  });
  document.querySelector('#search').addEventListener('input', render);
  document.querySelector('#category').addEventListener('change', render);
  document.querySelector('#add-item').addEventListener('click', () => editItem());
  document.querySelector('#cancel-item').addEventListener('click', () => dialog().close());
  dialog().addEventListener('cancel', (event) => {
    if (form().querySelector('[type=submit]').disabled) event.preventDefault();
  });
  document.querySelector('#close-detail').addEventListener('click', () => document.querySelector('#detail-dialog').close());
  document.querySelector('#detail-dialog').addEventListener('close', () => {
    detailVersion++;
    document.querySelector('#detail-images').replaceChildren();
  });
  form().addEventListener('submit', saveItem);
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
