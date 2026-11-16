import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productDetails, productNumberSearch, productURL, thawingTimeLabel } from '../js/product.js';

test('Produktnummernsuche verlinkt 3 bis 6 Ziffern bei bofrost und erhält führende Nullen', () => {
  for (const number of ['001', '1234', '11620', '012345']) {
    assert.deepEqual(productNumberSearch(` ${number} `), {
      label: 'Suche bei bofrost',
      href: `https://www.bofrost.de/search?text=${number}&searchType=product`,
    });
  }
});

test('EAN-Suche verlinkt genau 8 oder 13 Ziffern bei Open Food Facts', () => {
  for (const number of ['12345670', '00123457', '3017624010701', '0012345678905']) {
    assert.deepEqual(productNumberSearch(number), {
      label: 'Suche nach EAN',
      href: `https://world.openfoodfacts.org/product/${number}`,
    });
  }
});

test('Andere Längen, leere und nicht rein numerische Produktnummern bieten keine Suche an', () => {
  assert.equal(productNumberSearch(), null);
  for (const number of ['', ' ', '1', '12', '1234567', '123456789', '1234567890',
    '12345678901', '123456789012', '12345678901234', 'AB123', '12-34', '12 34', '+123', '１２３']) {
    assert.equal(productNumberSearch(number), null, number);
  }
});

test('Neue Produktfelder erhalten optionale Werte, Rating 0 und getrennte Teile', () => {
  assert.deepEqual(productDetails({}), {
    product_url: null, parts: null, favorite: null, usage_count: 0, rating: null,
  });
  assert.deepEqual(productDetails({
    product_url: 'https://example.org/produkt?q=1', parts: '6–8', favorite: false, usage_count: 12, rating: 0,
    notes: 'Teile: alter Wert',
  }), { product_url: 'https://example.org/produkt?q=1', parts: '6–8', favorite: false, usage_count: 12, rating: 0 });
  assert.equal(productDetails({ notes: 'Hinweis\nTeile: 02\r\nWeiter' }).parts, '02');
  assert.equal(productDetails({ parts: null, notes: 'Teile: 02' }).parts, null);
  assert.equal(productDetails({ rating: 5, favorite: true, usage_count: 2147483647 }).rating, 5);
  for (const fields of [
    { rating: -1 }, { rating: 6 }, { rating: 1.5 }, { rating: '5' },
    { usage_count: -1 }, { usage_count: null }, { usage_count: 2147483648 },
    { parts: 2 }, { favorite: 'false' }, { favorite: 0 },
  ]) assert.throws(() => productDetails(fields));
});

test('Produktlinks erlauben nur HTTP/HTTPS ohne Zugangsdaten', () => {
  assert.equal(productURL(' https://example.org/produkt '), 'https://example.org/produkt');
  assert.equal(productURL('http://example.org'), 'http://example.org/');
  assert.equal(productURL(''), null);
  for (const url of ['javascript:alert(1)', 'file:///test', '/relative', 'keine url',
    'https://user:password@example.org', 42]) assert.throws(() => productURL(url), /HTTP-/);
});

test('Auftauzeit rechnet nur Werte über 60 in Stunden und Restminuten um', () => {
  for (const [value, expected] of [
    [null, '—'], [0, '0 Min.'], [59, '59 Min.'], [60, '60 Min.'],
    [61, '1 Std. 1 Min.'], [90, '1 Std. 30 Min.'], [120, '2 Std.'],
    [1441, '24 Std. 1 Min.'], [2147483647, '35791394 Std. 7 Min.'],
  ]) assert.equal(thawingTimeLabel(value), expected);
});
