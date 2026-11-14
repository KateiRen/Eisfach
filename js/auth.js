const CONNECTION_KEY = 'eisfach.connection';
const SNAPSHOT_KEY = 'eisfach.inventory';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function saveConnection(connection) {
  const { inventoryId, deviceId, deviceToken } = connection;
  if (!uuid.test(inventoryId) || typeof deviceId !== 'string' || !deviceId ||
      typeof deviceToken !== 'string' || !deviceToken) {
    throw new Error('Ungültige Geräteverbindung.');
  }
  localStorage.removeItem(SNAPSHOT_KEY);
  localStorage.setItem(CONNECTION_KEY, JSON.stringify({ inventoryId, deviceId, deviceToken }));
}

export function loadConnection() {
  try {
    const value = JSON.parse(localStorage.getItem(CONNECTION_KEY));
    return value && uuid.test(value.inventoryId) &&
      typeof value.deviceId === 'string' && value.deviceId &&
      typeof value.deviceToken === 'string' && value.deviceToken ? value : null;
  } catch {
    return null;
  }
}

export function clearConnection() {
  localStorage.removeItem(CONNECTION_KEY);
  localStorage.removeItem(SNAPSHOT_KEY);
}

export function saveSnapshot(items) {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
      inventoryId: loadConnection()?.inventoryId, savedAt: new Date().toISOString(), items,
    }));
  } catch { /* Offline-Kopie ist optional (z. B. bei vollem Browserspeicher). */ }
}

export function loadSnapshot() {
  try {
    const snapshot = JSON.parse(localStorage.getItem(SNAPSHOT_KEY));
    return snapshot?.inventoryId === loadConnection()?.inventoryId && Array.isArray(snapshot?.items)
      ? snapshot : null;
  } catch {
    return null;
  }
}
