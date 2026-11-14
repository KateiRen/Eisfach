import { loadConnection, clearConnection } from './auth.js';
import { checkConnection } from './supabase.js';

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

async function init() {
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
  if (navigator.onLine) {
    try { await checkConnection(); } catch (error) {
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
}

// Beim Import durch Seitenmodule nicht erneut initialisieren.
if (document.querySelector('script[src="./js/app.js"]')) {
  init().catch((error) => status(error.message));
}
