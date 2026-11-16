import { rest, list } from './supabase.js';
import { element, action, status } from './app.js';
import { priceLabel } from './product.js';

let busy = false;
let available = false;

export function orderQuantity(value) {
  const quantity = Number(value);
  if (!/^\d+$/.test(String(value)) || !Number.isInteger(quantity) || quantity < 1 || quantity > 2147483647) {
    throw new Error('Bitte eine ganze Bestellmenge zwischen 1 und 2147483647 eingeben.');
  }
  return quantity;
}

export async function reorderProduct(itemId) {
  const saved = await rest('rpc/reorder_product', '', { method: 'POST', body: { p_item_id: itemId } });
  if (saved?.length !== 1 || saved[0].item_id !== itemId) {
    throw new Error('Nachbestellung konnte nicht bestätigt werden. Bitte vor erneutem Hinzufügen die Bestellliste prüfen.');
  }
  return saved[0];
}

export async function changeOrder(entry, quantity) {
  if (!entry.updated_at) throw new Error('Änderungsstand fehlt. Bitte die Bestellliste aktualisieren.');
  const removing = quantity === null;
  const saved = await rest('order_entries',
    `?id=eq.${encodeURIComponent(entry.id)}&updated_at=eq.${encodeURIComponent(entry.updated_at)}`, {
      method: removing ? 'DELETE' : 'PATCH',
      ...(removing ? {} : { body: { quantity: orderQuantity(quantity) } }),
      headers: { Prefer: 'return=representation' },
    });
  if (saved?.length !== 1) {
    throw new Error('Bestelleintrag wurde zwischenzeitlich geändert oder entfernt. Bitte die Bestellliste aktualisieren.');
  }
  return saved[0];
}

function updateControls() {
  const disabled = busy || !available || !navigator.onLine;
  for (const control of document.querySelectorAll('#orders button, #orders input')) control.disabled = disabled;
  document.querySelector('#reload-orders').disabled = busy || !navigator.onLine;
}

async function refresh() {
  available = false;
  updateControls();
  const [entries, products] = await Promise.all([
    list('order_entries', '?select=*&order=created_at.asc,id.asc'),
    list('items', '?select=id,name,product_number,price&order=name.asc,id.asc'),
  ]);
  const byId = new Map(products.map((item) => [item.id, item]));
  if (entries.some((entry) => !byId.has(entry.item_id))) {
    throw new Error('Ein Produkt ist nicht mehr verfügbar. Bitte die Bestellliste aktualisieren.');
  }
  const cards = entries.map((entry) => {
    const item = byId.get(entry.item_id);
    const card = element('section', undefined, 'card');
    const label = element('label', 'Bestellmenge');
    const input = element('input');
    input.type = 'number';
    input.min = '1';
    input.max = '2147483647';
    input.step = '1';
    input.required = true;
    input.value = entry.quantity;
    input.setAttribute('aria-label', `Bestellmenge: ${item.name}`);
    label.append(input);
    const buttons = element('div', undefined, 'actions');
    buttons.append(
      action('Menge speichern', () => runChange(entry, input.value)),
      action('Entfernen', () => runChange(entry, null), 'danger'),
    );
    card.append(element('h2', item.name),
      element('p', `Produktnummer: ${item.product_number || '—'}`, 'muted'),
      element('p', `Preis pro Packung: ${priceLabel(item.price)}`), label, buttons);
    return card;
  });
  document.querySelector('#orders').replaceChildren(
    ...(cards.length ? cards : [element('p', 'Die Bestellliste ist leer.')]));
  available = true;
}

async function runChange(entry, quantity) {
  if (busy) return;
  if (!available || !navigator.onLine) throw new Error('Bestellliste ist nur online änderbar. Bitte aktualisieren.');
  busy = true;
  updateControls();
  status('');
  let saved = false;
  try {
    await changeOrder(entry, quantity);
    saved = true;
    await refresh();
    status(quantity === null ? 'Bestelleintrag entfernt.' : 'Bestellmenge gespeichert.');
  } catch (error) {
    status(saved ? `Gespeichert, aber die Liste konnte nicht aktualisiert werden: ${error.message}` : error.message);
  } finally {
    busy = false;
    updateControls();
  }
}

async function reload() {
  if (busy) return;
  busy = true;
  updateControls();
  status('Bestellliste wird geladen …');
  try {
    if (!navigator.onLine) throw new Error('Die Bestellliste benötigt eine Internetverbindung.');
    await refresh();
    status('');
  } catch (error) {
    status(error.message);
  } finally {
    busy = false;
    updateControls();
  }
}

export async function initOrders() {
  document.querySelector('#reload-orders').addEventListener('click', reload);
  window.addEventListener('offline', () => {
    available = false;
    updateControls();
    status('Offline: Die geladene Bestellliste ist nur lesbar.');
  });
  window.addEventListener('online', updateControls);
  await reload();
}
