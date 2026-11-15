import { list } from './supabase.js';
import { element, status } from './app.js';
import { groupCatalog } from './inventory.js';
import { loadSorting, saveSorting, orderRecords } from './ordering.js';

let previous = null;
let categories = [];
let locations = [];
let compartments = new Map();
let available = false;

function renderOrder(records, label) {
  const list = element('ol', undefined, 'sorting-list');
  records.forEach((record, index) => {
    const row = element('li', undefined, 'sorting-row');
    const controls = element('div', undefined, 'actions');
    for (const [text, offset] of [['Nach oben', -1], ['Nach unten', 1]]) {
      const button = element('button', text, 'secondary');
      button.type = 'button';
      button.disabled = index + offset < 0 || index + offset >= records.length;
      button.setAttribute('aria-label', `${label(record)}: ${text}`);
      button.addEventListener('click', () => {
        const target = index + offset;
        [records[index], records[target]] = [records[target], records[index]];
        render();
        const row = document.querySelector(`[data-sort-id="${record.id}"]`);
        const next = row.querySelector(`[data-offset="${offset}"]`);
        (next.disabled ? row.querySelector(`[data-offset="${-offset}"]`) : next).focus();
      });
      button.dataset.offset = offset;
      controls.append(button);
    }
    row.dataset.sortId = record.id;
    row.append(element('span', label(record)), controls);
    list.append(row);
  });
  if (!records.length) list.append(element('li', 'Noch keine Einträge vorhanden.'));
  return list;
}

function render() {
  document.querySelector('#sort-categories').replaceChildren(
    renderOrder(categories, (record) => record.name || 'Ohne Kategorie'));
  document.querySelector('#sort-locations').replaceChildren(renderOrder(locations, (record) => record.name));
  document.querySelector('#sort-compartments').replaceChildren(...locations.map((location) => {
    const section = element('section');
    section.append(element('h3', location.name),
      renderOrder(compartments.get(location.id), (record) => record.name));
    return section;
  }));
}

async function save(event) {
  event.preventDefault();
  const controls = document.querySelector('#sorting-controls');
  controls.disabled = true;
  try {
    if (!available || !navigator.onLine) throw new Error('Sortierung ist nur online änderbar. Bitte neu laden.');
    previous = await saveSorting({
      categories: categories.map((record) => record.name),
      locations: locations.map((record) => record.id),
      compartments: locations.flatMap((location) => compartments.get(location.id).map((record) => record.id)),
    }, previous);
    status('Sortierung gespeichert. Die Reihenfolge gilt für alle Geräte dieses Inventars.');
  } catch (error) {
    status(error.message);
  } finally {
    controls.disabled = !available || !navigator.onLine;
  }
}

export async function initSorting() {
  document.querySelector('#sorting-form').addEventListener('submit', save);
  window.addEventListener('offline', () => {
    available = false;
    document.querySelector('#sorting-controls').disabled = true;
    status('Offline: Sortierung kann erst nach erneutem Laden mit Internet geändert werden.');
  });
  if (!navigator.onLine) {
    status('Sortierung benötigt Internet. Bitte online neu laden.');
    return;
  }
  status('Sortierung wird geladen …');
  const [products, loadedLocations, loadedCompartments, sorting] = await Promise.all([
    list('items', '?select=name,category&order=name.asc,id.asc'),
    list('storage_locations', '?select=*&order=name.asc,id.asc'),
    list('storage_compartments', '?select=*&order=name.asc,id.asc'),
    loadSorting(),
  ]);
  previous = sorting;
  categories = groupCatalog(products, (product) => product, sorting?.categories)
    .map((group, index) => ({ id: `category-${index}`, name: group.category }));
  locations = orderRecords(loadedLocations, sorting?.locations);
  compartments = new Map(locations.map((location) => [location.id,
    orderRecords(loadedCompartments.filter((record) => record.location_id === location.id), sorting?.compartments)]));
  render();
  available = navigator.onLine;
  document.querySelector('#sorting-controls').disabled = !available;
  if (available) status('');
}
