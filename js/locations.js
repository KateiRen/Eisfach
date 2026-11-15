export function locationLabel(entry, locations, compartments) {
  const place = locations.find((location) => location.id === entry.location_id);
  const compartment = compartments.find((item) =>
    item.id === entry.compartment_id && item.location_id === entry.location_id);
  return [place?.name, compartment?.name].filter(Boolean).join(' · ');
}

export function populateCompartments(select, compartments, locationId, selected = '', excludedId = '') {
  select.replaceChildren(new Option('Ohne Fach', ''),
    ...compartments.filter((item) => item.location_id === locationId && item.id !== excludedId)
      .map((item) => new Option(item.name, item.id)));
  select.value = selected;
  if (select.selectedIndex < 0) select.value = '';
}

export function locationSelection(fields, locations, compartments) {
  const location = locations.find((item) => item.id === fields.location_id);
  if (!location) throw new Error('Bitte einen definierten Ort auswählen.');
  const compartmentId = fields.compartment_id || null;
  if (compartmentId && !compartments.some((item) =>
    item.id === compartmentId && item.location_id === location.id)) {
    throw new Error('Das Fach gehört nicht zum gewählten Ort. Bitte erneut auswählen.');
  }
  return { location_id: location.id, compartment_id: compartmentId };
}
