import { SUPABASE_URL, SUPABASE_ANON_KEY, configured } from './config.js';
import { loadConnection } from './auth.js';

export async function request(path, { method = 'GET', body, authenticated = true, headers = {} } = {}) {
  if (!configured) throw new Error('Bitte Supabase zuerst in js/config.js konfigurieren.');
  const connection = loadConnection();
  if (authenticated && !connection) throw new Error('Kein Gerät verbunden.');
  const authHeaders = authenticated ? {
    'x-inventory-id': connection.inventoryId,
    'x-device-id': connection.deviceId,
    'x-device-token': connection.deviceToken,
  } : {};
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}${path}`, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: ['Bearer', SUPABASE_ANON_KEY].join(' '),
      'Content-Type': 'application/json',
      ...authHeaders, ...headers,
    },
    body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
    cache: 'no-store',
    credentials: 'omit',
  });
  if (!response.ok) {
    let message = `Anfrage fehlgeschlagen (${response.status}).`;
    try {
      const error = await response.json();
      message = error.error || error.message || message;
    } catch { /* Nicht-JSON-Fehler, etwa vom Netzwerk-Proxy. */ }
    throw new Error(message);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export const edge = (name, body, authenticated = true) =>
  request(`/functions/v1/${name}`, { method: 'POST', body, authenticated });

export const rest = (table, query = '', options) => request(`/rest/v1/${table}${query}`, options);
export const rpc = (name) => rest(`rpc/${name}`, '', { method: 'POST', body: {} });

export async function list(table, query = '?select=*&order=id.asc') {
  const parameters = new URLSearchParams(query.replace(/^\?/, ''));
  parameters.set('limit', '500');
  const rows = [];
  for (;;) {
    parameters.set('offset', String(rows.length));
    const page = await rest(table, `?${parameters}`);
    if (!page.length) return rows;
    rows.push(...page);
  }
}

export async function checkConnection() {
  const inventoryId = await rpc('current_inventory_id');
  if (inventoryId !== loadConnection()?.inventoryId) {
    const error = new Error('Dieses Gerät ist nicht mehr berechtigt. Bitte erneut verbinden.');
    error.revoked = true;
    throw error;
  }
  await rpc('touch_device');
}
