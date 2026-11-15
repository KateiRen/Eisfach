import { rest, list } from './supabase.js';
import { loadConnection } from './auth.js';
import { element, action, status } from './app.js';
import { locationSelection, populateCompartments } from './locations.js';
import { loadSorting, orderRecords } from './ordering.js';

let locations = [];
let compartments = [];
let stockEntries = [];
let editing = null;
let deleting = null;
let available = false;
const editForm = () => document.querySelector('#location-form');
const deleteForm = () => document.querySelector('#delete-location-form');
const editDialog = () => document.querySelector('#location-dialog');
const deleteDialog = () => document.querySelector('#delete-location-dialog');

async function refresh() {
  available = false;
  document.querySelector('#add-location').disabled = true;
  const loaded = await Promise.all([
    list('storage_locations', '?select=*&order=name.asc,id.asc'),
    list('storage_compartments', '?select=*&order=name.asc,id.asc'),
    list('stock_entries', '?select=id,location_id,compartment_id&order=id.asc'),
    loadSorting(),
  ]);
  const [loadedLocations, loadedCompartments, loadedStock, sorting] = loaded;
  locations = orderRecords(loadedLocations, sorting?.locations);
  compartments = orderRecords(loadedCompartments, sorting?.compartments);
  stockEntries = loadedStock;
  available = true;
  document.querySelector('#add-location').disabled = false;
  status('');
  const cards = locations.map((location) => {
    const card = element('section', undefined, 'card');
    const buttons = element('div', undefined, 'actions');
    buttons.append(
      action('Ort ändern', () => openEditor(location)),
      action('Fach anlegen', () => openEditor(null, location.id)),
      action('Ort löschen', () => openDelete(location), 'danger'),
    );
    card.append(element('h2', location.name), buttons);
    for (const compartment of compartments.filter((item) => item.location_id === location.id)) {
      const row = element('div', undefined, 'card');
      const actions = element('div', undefined, 'actions');
      actions.append(action('Fach ändern', () => openEditor(compartment, location.id)),
        action('Fach löschen', () => openDelete(compartment, location.id), 'danger'));
      row.append(element('h3', compartment.name), actions);
      card.append(row);
    }
    return card;
  });
  document.querySelector('#storage-locations').replaceChildren(
    ...(cards.length ? cards : [element('p', 'Noch keine Orte angelegt.')]));
}

function requireAvailable() {
  if (!available || !navigator.onLine) throw new Error('Orte und Fächer sind nur online änderbar. Bitte neu laden.');
}

function openEditor(record = null, locationId = null) {
  requireAvailable();
  editing = { record, locationId };
  editForm().reset();
  editForm().elements.name.value = record?.name ?? '';
  document.querySelector('#location-title').textContent =
    `${locationId ? 'Fach' : 'Ort'} ${record ? 'ändern' : 'anlegen'}`;
  document.querySelector('#location-status').textContent = '';
  editDialog().showModal();
}

async function save(event) {
  event.preventDefault();
  const submit = editForm().querySelector('[type=submit]');
  const cancel = document.querySelector('#cancel-location');
  submit.disabled = cancel.disabled = true;
  try {
    requireAvailable();
    const name = editForm().elements.name.value.trim();
    if (!name || name.length > 200) throw new Error('Bitte einen Namen mit 1–200 Zeichen eingeben.');
    const { record, locationId } = editing;
    const body = { name };
    if (!record) {
      body.inventory_id = loadConnection().inventoryId;
      if (locationId) body.location_id = locationId;
    }
    const filter = record
      ? `?id=eq.${record.id}&updated_at=eq.${encodeURIComponent(record.updated_at)}` : '';
    const saved = await rest(locationId ? 'storage_compartments' : 'storage_locations', filter, {
      method: record ? 'PATCH' : 'POST', body, headers: { Prefer: 'return=representation' },
    });
    if (!saved?.length) throw new Error('Ort oder Fach wurde zwischenzeitlich geändert oder entfernt. Bitte neu laden.');
    editDialog().close();
    await refresh();
  } catch (error) {
    if (editDialog().open) document.querySelector('#location-status').textContent = error.message;
    else status(`Gespeichert, aber die Liste konnte nicht aktualisiert werden: ${error.message}`);
  } finally {
    submit.disabled = cancel.disabled = false;
  }
}

function openDelete(record, parentId = null) {
  requireAvailable();
  const locationId = parentId || record.id;
  const compartmentId = parentId ? record.id : null;
  deleting = { record, locationId, compartmentId };
  deleteForm().reset();
  const count = stockEntries.filter((entry) => entry.location_id === locationId &&
    (!compartmentId || entry.compartment_id === compartmentId)).length;
  const targets = locations.filter((item) => compartmentId || item.id !== locationId);
  deleteForm().elements.location_id.replaceChildren(
    new Option(count ? 'Bitte Ersatzort auswählen' : 'Kein Ersatz nötig (nur ohne Bestand)', ''),
    ...targets.map((item) => new Option(item.name, item.id)));
  deleteForm().elements.location_id.required = count > 0;
  populateCompartments(deleteForm().elements.compartment_id, compartments, '');
  document.querySelector('#delete-location-title').textContent = `${parentId ? 'Fach' : 'Ort'} „${record.name}“ löschen`;
  document.querySelector('#delete-location-info').textContent =
    `${count} Bestandspositionen betroffen.${count && !targets.length ? ' Bitte zuerst einen anderen Ort anlegen.' : ''}`;
  document.querySelector('#delete-location-status').textContent = '';
  deleteDialog().showModal();
}

async function remove(event) {
  event.preventDefault();
  const submit = deleteForm().querySelector('[type=submit]');
  const cancel = document.querySelector('#cancel-delete-location');
  submit.disabled = cancel.disabled = true;
  try {
    requireAvailable();
    const fields = Object.fromEntries(new FormData(deleteForm()));
    const target = fields.location_id
      ? locationSelection(fields, locations, compartments)
      : { location_id: null, compartment_id: null };
    const { record, locationId, compartmentId } = deleting;
    const moved = await rest('rpc/delete_storage_location', '', { method: 'POST', body: {
      p_location_id: locationId, p_compartment_id: compartmentId, p_updated_at: record.updated_at,
      p_target_location_id: target.location_id, p_target_compartment_id: target.compartment_id,
    } });
    deleteDialog().close();
    await refresh();
    status(`Gelöscht. ${moved} Bestandspositionen umgelagert.`);
  } catch (error) {
    if (deleteDialog().open) document.querySelector('#delete-location-status').textContent = error.message;
    else status(`Gelöscht, aber die Liste konnte nicht aktualisiert werden: ${error.message}`);
  } finally {
    submit.disabled = cancel.disabled = false;
  }
}

export async function initFreezer() {
  document.querySelector('#add-location').addEventListener('click', () => {
    try { openEditor(); } catch (error) { status(error.message); }
  });
  editForm().addEventListener('submit', save);
  deleteForm().addEventListener('submit', remove);
  document.querySelector('#cancel-location').addEventListener('click', () => editDialog().close());
  document.querySelector('#cancel-delete-location').addEventListener('click', () => deleteDialog().close());
  deleteForm().elements.location_id.addEventListener('change', () => {
    populateCompartments(deleteForm().elements.compartment_id, compartments,
      deleteForm().elements.location_id.value, '', deleting.compartmentId);
  });
  for (const dialog of [editDialog(), deleteDialog()]) {
    dialog.addEventListener('cancel', (event) => {
      if (dialog.querySelector('[type=submit]').disabled) event.preventDefault();
    });
  }
  window.addEventListener('offline', () => {
    available = false;
    document.querySelector('#add-location').disabled = true;
    status('Offline: Orte und Fächer können erst nach erneutem Laden mit Internet geändert werden.');
  });
  await refresh();
}
