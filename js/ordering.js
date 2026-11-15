import { rest } from './supabase.js';
import { loadConnection } from './auth.js';

export async function loadSorting() {
  const rows = await rest('inventory_sorting', '?select=*&limit=1');
  return rows[0] ?? null;
}

export async function saveSorting(order, previous) {
  const inventoryId = loadConnection().inventoryId;
  const query = previous
    ? `?inventory_id=eq.${inventoryId}&updated_at=eq.${encodeURIComponent(previous.updated_at)}` : '';
  const rows = await rest('inventory_sorting', query, {
    method: previous ? 'PATCH' : 'POST',
    body: { inventory_id: inventoryId, ...order },
    headers: { Prefer: 'return=representation' },
  });
  if (!rows?.length) throw new Error('Die Sortierung wurde zwischenzeitlich geändert. Bitte neu laden.');
  return rows[0];
}

export function compareOrder(a, b, order = []) {
  const left = order.indexOf(a);
  const right = order.indexOf(b);
  if (left === right) return 0;
  if (left < 0) return 1;
  if (right < 0) return -1;
  return left - right;
}

export function orderRecords(records, order = []) {
  return [...records].sort((a, b) =>
    compareOrder(a.id, b.id, order) || a.name.localeCompare(b.name, 'de') || a.id.localeCompare(b.id));
}

export function orderStockPositions(entries, locations, compartments) {
  const locationRanks = new Map(locations.map((record, index) => [record.id, index]));
  const compartmentRanks = new Map(compartments.map((record, index) => [record.id, index]));
  const rank = (map, id) => id == null ? -1 : map.get(id) ?? Number.MAX_SAFE_INTEGER;
  return [...entries].sort((a, b) =>
    rank(locationRanks, a.location_id) - rank(locationRanks, b.location_id) ||
    rank(compartmentRanks, a.compartment_id) - rank(compartmentRanks, b.compartment_id));
}
