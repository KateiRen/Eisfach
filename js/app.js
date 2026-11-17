import { loadConnection, clearConnection } from './auth.js';
import { checkConnection, rest, rpc } from './supabase.js';
import { loadAppearance, applyAppearance, initAppearance } from './appearance.js';
import { initUpdates } from './updates.js';

export function status(message) {
  document.querySelector('#status').textContent = message;
}

export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function action(label, handler, className = 'secondary') {
  const button = element('button', label, className);
  button.type = 'button';
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await handler(); } catch (error) { status(error.message); }
    finally { button.disabled = false; }
  });
  return button;
}

function initNavigation(page) {
  const nav = document.querySelector('nav[aria-label="Hauptnavigation"]');
  const shortcuts = element('div', undefined, 'navigation-shortcuts');
  const menu = element('details', undefined, 'navigation-menu');
  menu.append(element('summary', 'Menü'));
  const links = element('div', undefined, 'navigation-links');
  const settings = element('details');
  settings.append(element('summary', 'Einstellungen'));
  const settingsLinks = element('div', undefined, 'settings-links');
  for (const [label, href, target] of [
    ['Bestand', './app.html#stock', 'stock'],
    ['Produktliste', './app.html#catalog', 'catalog'],
    ['Bestellliste', './orders.html', 'orders'],
    ['Geräte', './devices.html', 'devices'],
    ['Orte und Fächer', './freezer.html', 'freezer'],
    ['Sortierung', './sorting.html', 'sorting'],
    ['Bulk-Edit', './bulk-edit.html', 'bulk-edit'],
    ['Aussehen', './appearance.html', 'appearance'],
    ['Export/Import', './transfer.html', 'transfer'],
  ]) {
    const link = element('a', label);
    link.href = href;
    link.dataset.navigation = target;
    if (target === 'stock' || target === 'catalog' || target === 'orders') {
      if (page === target) link.setAttribute('aria-current', 'page');
      links.append(link);
      const shortcut = link.cloneNode(true);
      shortcut.addEventListener('click', () => { menu.open = false; });
      shortcuts.append(shortcut);
    } else {
      settingsLinks.append(link);
      if (page === target) {
        link.setAttribute('aria-current', 'page');
        settings.open = true;
      }
    }
    link.addEventListener('click', () => { menu.open = false; });
  }
  settings.append(settingsLinks);
  links.append(settings);
  menu.append(links);
  nav.replaceChildren(shortcuts, menu);
  document.addEventListener('click', (event) => {
    if (!nav.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });
}

async function init() {
  try { applyAppearance(loadAppearance()); } catch (error) { status(error.message); }
  initUpdates(status).catch((error) => status(`App-Updates konnten nicht eingerichtet werden: ${error.message}`));
  window.addEventListener('offline', () => status('Offline: Die zuletzt geladene Liste ist lesbar. Änderungen benötigen Internet.'));
  window.addEventListener('online', () => status('Wieder online. Bitte neu laden, um die Daten zu aktualisieren.'));
  const page = document.body.dataset.page;
  if (page === 'home') {
    location.replace(loadConnection() ? './app.html' : './setup.html');
    return;
  }
  if (page === 'setup') {
    (await import('./setup.js')).initSetup();
    return;
  }
  if (!loadConnection()) {
    location.replace('./setup.html');
    return;
  }
  initNavigation(page);
  if (page === 'appearance') initAppearance();
  if (navigator.onLine) {
    try {
      await checkConnection();
      const supplementary = Promise.all([
        rpc('touch_device'), rest('inventories', '?select=name'),
      ]).then(([, inventories]) => {
        document.querySelector('#inventory-name').textContent = inventories[0]?.name || 'Dein Inventar';
      });
      if (page === 'inventory') {
        supplementary.catch((error) => status(`Zusätzliche Inventarinformationen konnten nicht geladen werden: ${error.message}`));
      } else {
        await supplementary;
      }
    } catch (error) {
      if (error.revoked) {
        clearConnection();
        location.replace('./setup.html?revoked=1');
        return;
      }
      status(error.message);
    }
  }
  if (page === 'inventory') await (await import('./inventory.js')).initInventory();
  if (page === 'orders') await (await import('./orders.js')).initOrders();
  if (page === 'devices') await (await import('./devices.js')).initDevices();
  if (page === 'freezer') await (await import('./freezer.js')).initFreezer();
  if (page === 'sorting') await (await import('./sorting.js')).initSorting();
  if (page === 'bulk-edit') await (await import('./bulk-edit.js')).initBulkEdit();
  if (page === 'transfer') (await import('./transfer.js')).initTransfer();
}

// Beim Import durch Seitenmodule nicht erneut initialisieren.
if (document.querySelector('script[src="./js/app.js"]')) {
  init().catch((error) => status(error.message));
}
