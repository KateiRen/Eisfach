import { rest, list } from './supabase.js';
import { element, action, status } from './app.js';
import { optionalPrice, priceLabel } from './product.js';

let busy = false;
let available = false;

export function orderAmounts(rows) {
  const amounts = rows.map(({ price, quantity }) => {
    const unitPrice = optionalPrice(price);
    return unitPrice === null ? null : BigInt(Math.round(unitPrice * 100)) * BigInt(orderQuantity(quantity));
  });
  return {
    amounts,
    total: amounts.some((amount) => amount === null) ? null : amounts.reduce((sum, amount) => sum + amount, 0n),
  };
}

export function orderAmountLabel(cents) {
  return cents === null ? '—'
    : `${(cents / 100n).toLocaleString('de-DE')},${String(cents % 100n).padStart(2, '0')}\u00a0€`;
}

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

export function steppedOrderQuantity(quantity, step) {
  const current = orderQuantity(quantity);
  if (step !== -1 && step !== 1) throw new Error('Die Bestellmenge kann nur um ein Stück geändert werden.');
  return current === 1 && step === -1 ? null : orderQuantity(current + step);
}

export async function receiveOrder(entry, position) {
  const quantity = orderQuantity(position.quantity);
  if (!entry.updated_at || entry.item_id !== position.item_id || quantity > entry.quantity) {
    throw new Error('Bitte die Bestellliste aktualisieren und höchstens die offene Bestellmenge einlagern.');
  }
  const saved = await rest('rpc/receive_order', '', { method: 'POST', body: {
    p_order_id: entry.id, p_item_id: entry.item_id, p_updated_at: entry.updated_at,
    p_id: position.id, p_location_id: position.location_id,
    p_compartment_id: position.compartment_id, p_quantity: quantity,
  } });
  if (saved?.length !== 1 || saved[0].id !== position.id) {
    throw new Error('Einlagerung konnte nicht bestätigt werden. Bitte mit denselben Werten erneut versuchen.');
  }
  return saved[0];
}

function updateControls() {
  const disabled = busy || !available || !navigator.onLine;
  for (const control of document.querySelectorAll('#orders button')) {
    control.disabled = disabled || control.dataset.atLimit === 'true';
  }
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
  const totals = orderAmounts(entries.map((entry) => ({
    price: byId.get(entry.item_id).price, quantity: entry.quantity,
  })));
  const rows = entries.map((entry, index) => {
    const item = byId.get(entry.item_id);
    const row = element('tr');
    const product = element('th', item.name);
    product.scope = 'row';
    product.append(element('span', item.product_number || '—', 'muted'));
    const quantity = element('td');
    const control = element('div', undefined, 'quantity-control');
    const down = action('−', () => runChange(entry, steppedOrderQuantity(entry.quantity, -1)));
    const up = action('+', () => runChange(entry, steppedOrderQuantity(entry.quantity, 1)));
    down.setAttribute('aria-label', `Bestellmenge verringern: ${item.name}`);
    up.setAttribute('aria-label', `Bestellmenge erhöhen: ${item.name}`);
    up.dataset.atLimit = String(entry.quantity >= 2147483647);
    const amount = element('output', String(entry.quantity), 'quantity');
    amount.setAttribute('aria-label', `Bestellmenge: ${item.name}`);
    control.append(down, amount, up);
    quantity.append(control);
    const actions = element('td');
    const buttons = element('div', undefined, 'actions compact-actions');
    const edit = action('Produkt aktualisieren', () => {
      location.assign(`./app.html?edit-product=${encodeURIComponent(item.id)}#catalog`);
    });
    const store = action('Einlagern', () => {
      location.assign(`./app.html?receive-order=${encodeURIComponent(entry.id)}#catalog`);
    });
    edit.setAttribute('aria-label', `Produkt aktualisieren: ${item.name}`);
    store.setAttribute('aria-label', `Einlagern: ${item.name}`);
    buttons.append(edit, store);
    actions.append(buttons);
    row.append(product, quantity, element('td', priceLabel(item.price), 'order-price'),
      element('td', orderAmountLabel(totals.amounts[index]), 'order-price'), actions);
    return row;
  });
  document.querySelector('#order-rows').replaceChildren(
    ...rows);
  document.querySelector('#order-total').textContent = orderAmountLabel(totals.total);
  document.querySelector('#order-price-note').hidden = totals.total !== null;
  document.querySelector('#order-table').hidden = entries.length === 0;
  document.querySelector('#empty-orders').hidden = entries.length > 0;
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
