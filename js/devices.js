import { rest, edge, list } from './supabase.js';
import { loadConnection, clearConnection } from './auth.js';
import { renderQR } from './scanner.js';
import { element, action, status } from './app.js';

const date = (value) => value ? new Date(value).toLocaleString('de-DE') : 'Noch keine Aktivität';

async function refresh() {
  const devices = await list('device_registrations',
    '?select=id,inventory_id,device_id,device_name,revoked,created_at,last_seen_at&order=created_at.asc,id.asc');
  document.querySelector('#devices').replaceChildren(...devices.map((device) => {
    const current = device.device_id === loadConnection().deviceId;
    const card = element('article', undefined, 'card');
    card.append(element('h2', `${device.device_name}${current ? ' (dieses Gerät)' : ''}`),
      element('p', device.revoked ? 'Deaktiviert' : 'Aktiv'),
      element('p', `Registriert: ${date(device.created_at)}`),
      element('p', `Letzte Aktivität: ${date(device.last_seen_at)}`));
    const buttons = element('div', undefined, 'actions');
    buttons.append(action('Umbenennen', async () => {
      const name = prompt('Neuer Gerätename (maximal 100 Zeichen)', device.device_name);
      if (name === null) return;
      if (!name.trim() || name.trim().length > 100) throw new Error('Bitte einen Namen mit 1–100 Zeichen eingeben.');
      await rest('device_registrations', `?id=eq.${device.id}`, {
        method: 'PATCH', body: { device_name: name.trim() },
      });
      await refresh();
    }));
    if (!device.revoked) buttons.append(action('Deaktivieren', async () => {
      if (!confirm(`${device.device_name} deaktivieren?${current ? ' Du verlierst den Zugriff auf dieses Inventar.' : ''}`)) return;
      await edge('revokeDevice', { deviceId: device.device_id });
      if (current) disconnect();
      else await refresh();
    }, 'danger'));
    buttons.append(action('Löschen', async () => {
      if (!confirm(`${device.device_name} endgültig löschen?${current ? ' Du verlierst den Zugriff auf dieses Inventar.' : ''}`)) return;
      await rest('device_registrations', `?id=eq.${device.id}`, { method: 'DELETE' });
      if (current) disconnect();
      else await refresh();
    }, 'danger'));
    card.append(buttons);
    return card;
  }));
}

function disconnect() {
  clearConnection();
  location.replace('./setup.html');
}

export async function initDevices() {
  let expiryTimer;
  const hidePairing = () => {
    clearTimeout(expiryTimer);
    document.querySelector('#pairing').hidden = true;
    document.querySelector('#join-code').textContent = '';
    document.querySelector('#join-qr').replaceChildren();
  };
  document.querySelector('#hide-pairing').addEventListener('click', hidePairing);
  document.querySelector('#disconnect').addEventListener('click', () => {
    if (confirm('Lokale Verbindung und Offline-Kopie entfernen? Die Registrierung bleibt aktiv; zum Widerrufen vorher deaktivieren.')) disconnect();
  });
  document.querySelector('#pair-device').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    hidePairing();
    try {
      const result = await edge('createJoinToken', {});
      document.querySelector('#join-code').textContent = result.joinToken;
      document.querySelector('#join-expiry').textContent = `Einmal verwendbar · gültig bis ${date(result.expiresAt)} · Inventar-ID: ${loadConnection().inventoryId}`;
      document.querySelector('#pairing').hidden = false;
      expiryTimer = setTimeout(hidePairing, Math.max(0, new Date(result.expiresAt).getTime() - Date.now()));
      try {
        await renderQR(document.querySelector('#join-qr'), JSON.stringify({
          inventoryId: loadConnection().inventoryId, joinToken: result.joinToken,
        }));
      } catch {
        status('QR-Bibliothek nicht erreichbar. Inventar-ID und Join-Code können manuell eingegeben werden.');
      }
    } catch (error) { status(error.message); }
    finally { button.disabled = false; }
  });
  await refresh();
}
