export function productNumberSearch(value = '') {
  const number = value.trim();
  if (/^\d{3,6}$/.test(number)) {
    return {
      label: 'Suche bei bofrost',
      href: `https://www.bofrost.de/search?text=${number}&searchType=product`,
    };
  }
  if (/^(?:\d{8}|\d{13})$/.test(number)) {
    return {
      label: 'Suche nach EAN',
      href: `https://world.openfoodfacts.org/product/${number}`,
    };
  }
  return null;
}

export function productURL(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error('Die Produktseite muss eine HTTP-/HTTPS-URL sein.');
  let url;
  try { url = new URL(value.trim()); }
  catch { throw new Error('Bitte eine gültige HTTP-/HTTPS-URL für die Produktseite eingeben.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Die Produktseite muss eine HTTP-/HTTPS-URL ohne Zugangsdaten sein.');
  }
  return url.href;
}

export function productDetails(item) {
  const parts = item.parts === undefined
    ? (item.notes || '').match(/^Teile:[ \t]*([^\r\n]*)/mi)?.[1].trim() || null : item.parts;
  const favorite = item.favorite === undefined ? null : item.favorite;
  const rating = item.rating === undefined ? null : item.rating;
  const usageCount = item.usage_count === undefined ? 0 : item.usage_count;
  if (parts !== null && typeof parts !== 'string') throw new Error('Teile muss Text oder leer sein.');
  if (favorite !== null && typeof favorite !== 'boolean') throw new Error('Favorit muss Ja, Nein oder leer sein.');
  if (rating !== null && (!Number.isInteger(rating) || rating < 0 || rating > 5)) {
    throw new Error('Rating muss eine ganze Zahl zwischen 0 und 5 oder leer sein.');
  }
  if (!Number.isInteger(usageCount) || usageCount < 0 || usageCount > 2147483647) {
    throw new Error('Der Nutzungscounter muss eine nichtnegative ganze Zahl sein.');
  }
  return { product_url: productURL(item.product_url), parts, favorite, usage_count: usageCount, rating };
}

export function thawingTimeLabel(minutes) {
  if (minutes == null) return '—';
  if (minutes <= 60) return `${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours} Std.${remainder ? ` ${remainder} Min.` : ''}`;
}

export function optionalInteger(value) {
  if (value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 2147483647) {
    throw new Error('Zeiten müssen nichtnegative ganze Minuten sein.');
  }
  return number;
}

export function optionalWeight(value) {
  if (value === '') return null;
  const weight = Number(value);
  if (!/^\d+(?:\.\d{1,3})?$/.test(value) ||
      !Number.isFinite(weight) || weight < 0 || weight > 999999999.999) {
    throw new Error('Bitte ein gültiges Packungsgewicht mit höchstens drei Nachkommastellen eingeben.');
  }
  return weight;
}

export function optionalPrice(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('Bitte einen gültigen Preis in Euro mit höchstens zwei Nachkommastellen eingeben.');
  }
  const text = String(value).trim().replace(',', '.');
  if (text === '' && typeof value === 'string') return null;
  const price = Number(text);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text) || !Number.isFinite(price) || price < 0 || price > 99999999.99) {
    throw new Error('Bitte einen gültigen Preis in Euro mit höchstens zwei Nachkommastellen eingeben.');
  }
  return price;
}

export function priceLabel(value) {
  const price = optionalPrice(value);
  return price === null ? '—' : price.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}
