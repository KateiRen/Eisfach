import { edge } from './supabase.js';
import { saveConnection, loadConnection } from './auth.js';
import { configured } from './config.js';
import { scanQR } from './scanner.js';

export function initSetup() {
  if (loadConnection()) {
    location.replace('./app.html');
    return;
  }
  document.querySelector('#configuration').hidden = configured;
  const status = document.querySelector('#status');
  for (const [id, endpoint] of [['create-form', 'createInventory'], ['join-form', 'registerDevice']]) {
    const form = document.getElementById(id);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button');
      button.disabled = true;
      status.textContent = 'Gerät wird verbunden …';
      try {
        const values = Object.fromEntries(new FormData(form));
        if (values.joinToken) values.joinToken = values.joinToken.trim().toUpperCase();
        if (values.inventoryId) values.inventoryId = values.inventoryId.trim();
        saveConnection(await edge(endpoint, values, false));
        location.replace('./app.html');
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
  }
  document.querySelector('#scan-join').addEventListener('click', async () => {
    try {
      const result = await scanQR();
      if (!result) return;
      const value = JSON.parse(result);
      if (typeof value.inventoryId !== 'string' || typeof value.joinToken !== 'string') {
        throw new Error('Der QR-Code enthält keine Verbindungsdaten.');
      }
      const form = document.querySelector('#join-form');
      form.elements.inventoryId.value = value.inventoryId;
      form.elements.joinToken.value = value.joinToken;
      form.elements.deviceName.focus();
    } catch (error) {
      status.textContent = `QR-Code konnte nicht übernommen werden: ${error.message}`;
    }
  });
  if (new URLSearchParams(location.search).get('mode') === 'join') {
    document.querySelector('#join').scrollIntoView();
  }
}
