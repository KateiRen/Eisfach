import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAppearance, saveAppearance, appearanceColors, applyAppearance } from '../js/appearance.js';

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
};

test('Akzentfarben bleiben unabhängig von Verbindung und Inventar im Browser gespeichert', () => {
  storage.clear();
  assert.deepEqual(loadAppearance(), { primary: '#126b73', secondary: null });
  saveAppearance({ primary: '#ABCDEF', secondary: '#9822AA' });
  storage.set('eisfach.connection', '{"deviceId":"anderes-geraet"}');
  assert.deepEqual(loadAppearance(), { primary: '#abcdef', secondary: '#9822aa' });
  storage.delete('eisfach.connection');
  assert.equal(loadAppearance().primary, '#abcdef');
  saveAppearance({ primary: '#126b73', secondary: null });
  assert.equal(loadAppearance().secondary, null);
});

test('Ungültige Einstellungen und Speicherfehler werden gemeldet statt als Erfolg behandelt', (t) => {
  storage.clear();
  for (const value of [
    { primary: 'red', secondary: null }, { primary: '#123456', secondary: 'url(test)' },
    { primary: '#123456' }, null,
  ]) {
    assert.throws(() => saveAppearance(value), /Ungültige Farbeinstellung/);
    storage.set('eisfach.appearance', JSON.stringify(value));
    assert.throws(() => loadAppearance(), /Ungültige Farbeinstellung/);
  }
  storage.set('eisfach.appearance', '{');
  assert.throws(() => loadAppearance(), /nicht gelesen/);
  t.mock.method(globalThis.localStorage, 'setItem', () => { throw new Error('Speicher voll'); });
  assert.throws(() => saveAppearance({ primary: '#123456', secondary: null }), /Speicher voll/);
});

function luminance(color) {
  const values = color.match(/[a-f0-9]{2}/gi).map((part) => {
    const value = parseInt(part, 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
}

function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}

test('Helle und dunkle Akzentfarben behalten lesbare Beschriftungen und Links', () => {
  for (const color of ['#ffffff', '#000000', '#ffff00', '#00ff00', '#ff0000', '#0000ff', '#126b73', '#888888']) {
    const result = appearanceColors({ primary: color, secondary: null });
    assert.equal(result.primary, color);
    assert.ok(contrast(result.primary, result.foreground) >= 4.5, color);
    for (const surface of ['#ffffff', '#f1f7f7', '#e2f1f1']) {
      assert.ok(contrast(result.link, surface) >= 4.5, `${color} auf ${surface}`);
    }
  }
  const result = appearanceColors({ primary: '#126b73', secondary: '#9822aa' });
  assert.equal(result.link, '#9822aa');
  assert.equal(result.primary, '#126b73');
});

test('Beide Akzentfarben werden als CSS-Variablen und Browser-Themenfarbe angewendet', (t) => {
  const properties = new Map();
  const theme = {};
  const previousDocument = globalThis.document;
  t.after(() => { globalThis.document = previousDocument; });
  globalThis.document = {
    documentElement: { style: { setProperty: (key, value) => properties.set(key, value) } },
    querySelector: () => theme,
  };
  applyAppearance({ primary: '#ffff00', secondary: '#9822aa' });
  assert.equal(properties.get('--accent'), '#ffff00');
  assert.equal(properties.get('--accent-foreground'), '#000000');
  assert.equal(properties.get('--accent-link'), '#9822aa');
  assert.equal(theme.content, '#ffff00');
});
