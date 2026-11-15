import { loadConnection, clearConnection } from './auth.js';
import { checkConnection, rest } from './supabase.js';
import { loadAppearance, applyAppearance, initAppearance } from './appearance.js';

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
    ['Geräte', './devices.html', 'devices'],
    ['Gefrierschrank', './freezer.html', 'freezer'],
    ['Aussehen', './appearance.html', 'appearance'],
  ]) {
    const link = element('a', label);
    link.href = href;
    link.dataset.navigation = target;
    if (target === 'stock' || target === 'catalog') {
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
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }
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
      const inventories = await rest('inventories', '?select=name');
      document.querySelector('#inventory-name').textContent = inventories[0]?.name || 'Dein Inventar';
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
  if (page === 'devices') await (await import('./devices.js')).initDevices();
  if (page === 'freezer') await (await import('./freezer.js')).initFreezer();
}

// Beim Import durch Seitenmodule nicht erneut initialisieren.
if (document.querySelector('script[src="./js/app.js"]')) {
  init().catch((error) => status(error.message));
}
