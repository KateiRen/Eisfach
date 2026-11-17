import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { initUpdates } from '../js/updates.js';

class Node extends EventTarget {
  children = [];
  disabled = false;
  attributes = {};
  append(...children) { this.children.push(...children); }
  prepend(child) { this.children.unshift(child); }
  setAttribute(name, value) { this.attributes[name] = value; }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
}

function environment(t, { controlled = true, waiting = false, installing = false } = {}) {
  const main = new Node();
  const document = new EventTarget();
  document.visibilityState = 'visible';
  document.createElement = () => new Node();
  document.querySelector = () => main;
  const window = new EventTarget();
  let reloads = 0;
  let confirmed = true;
  window.location = { reload: () => { reloads++; } };
  window.confirm = () => confirmed;
  const messages = [];
  const worker = new EventTarget();
  worker.postMessage = (message) => messages.push(message);
  const registration = new EventTarget();
  registration.waiting = waiting ? worker : null;
  registration.installing = installing ? worker : null;
  let checks = 0;
  registration.update = async () => { checks++; };
  const serviceWorker = new EventTarget();
  serviceWorker.controller = controlled ? {} : null;
  const registrations = [];
  serviceWorker.register = async (...args) => {
    registrations.push(args);
    return registration;
  };
  const navigator = { serviceWorker, onLine: true };
  for (const [name, value] of Object.entries({ document, window, navigator })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    });
  }
  const errors = [];
  return {
    main, document, window, navigator, registration, serviceWorker, worker, messages, registrations, errors,
    reportError: (message) => errors.push(message),
    get button() { return main.children[0]?.children[1]; },
    get reloads() { return reloads; },
    get checks() { return checks; },
    set confirmed(value) { confirmed = value; },
  };
}

test('Bereits wartendes Update wird angezeigt und erst nach Bestätigung und Aktivierung neu geladen', async (t) => {
  const env = environment(t, { waiting: true });
  await initUpdates(env.reportError);
  assert.deepEqual(env.registrations, [['./service-worker.js', { updateViaCache: 'none' }]]);
  assert.equal(env.main.children.length, 1);
  assert.equal(env.button.textContent, 'Jetzt aktualisieren');
  assert.match(env.main.children[0].children[0].textContent, /Update verfügbar.*Änderungen speichern/);
  assert.equal(env.messages.length, 0);
  env.confirmed = false;
  env.button.click();
  assert.equal(env.messages.length, 0);
  env.confirmed = true;
  env.button.click();
  env.button.click();
  assert.deepEqual(env.messages, [{ type: 'SKIP_WAITING' }]);
  assert.equal(env.reloads, 0);
  env.registration.waiting = null;
  env.serviceWorker.dispatchEvent(new Event('controllerchange'));
  env.serviceWorker.dispatchEvent(new Event('controllerchange'));
  assert.equal(env.reloads, 1);
});

test('Updates werden während und nach der Registrierung erkannt, ohne doppelte Hinweise', async (t) => {
  for (const installing of [true, false]) {
    const env = environment(t, { installing });
    await initUpdates(env.reportError);
    assert.equal(env.main.children.length, 0);
    env.registration.installing = env.worker;
    env.registration.dispatchEvent(new Event('updatefound'));
    env.worker.dispatchEvent(new Event('statechange'));
    assert.equal(env.main.children.length, 0);
    env.registration.waiting = env.worker;
    env.worker.dispatchEvent(new Event('statechange'));
    env.worker.dispatchEvent(new Event('statechange'));
    assert.equal(env.main.children.length, 1);
    assert.equal(env.reloads, 0);
  }
});

test('Erstinstallation löst weder Update-Hinweis noch Neuladen aus', async (t) => {
  const env = environment(t, { controlled: false, installing: true });
  await initUpdates(env.reportError);
  env.registration.waiting = env.worker;
  env.worker.dispatchEvent(new Event('statechange'));
  env.serviceWorker.controller = {};
  env.serviceWorker.dispatchEvent(new Event('controllerchange'));
  assert.equal(env.main.children.length, 0);
  assert.equal(env.reloads, 0);
});

test('Aktivierung in einem anderen Fenster lädt erst nach eigenem Klick neu', async (t) => {
  const env = environment(t);
  await initUpdates(env.reportError);
  env.serviceWorker.dispatchEvent(new Event('controllerchange'));
  assert.equal(env.reloads, 0);
  assert.equal(env.button.textContent, 'Jetzt aktualisieren');
  env.button.click();
  assert.equal(env.reloads, 1);
  assert.equal(env.messages.length, 0);
});

test('Rückkehr und Wiederverbindung prüfen Updates, offline nicht; Fehler werden gemeldet', async (t) => {
  const env = environment(t);
  await initUpdates(env.reportError);
  env.document.visibilityState = 'hidden';
  env.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(env.checks, 0);
  env.document.visibilityState = 'visible';
  env.document.dispatchEvent(new Event('visibilitychange'));
  env.window.dispatchEvent(new Event('online'));
  assert.equal(env.checks, 2);
  env.navigator.onLine = false;
  env.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(env.checks, 2);
  env.navigator.onLine = true;
  env.registration.update = async () => { throw new Error('Netzwerkfehler'); };
  env.window.dispatchEvent(new Event('online'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(env.errors, ['App-Update konnte nicht geprüft werden: Netzwerkfehler']);
});

test('Aktivierungsfehler und verschwundene Updates werden sichtbar gemeldet', async (t) => {
  const env = environment(t, { waiting: true });
  await initUpdates(env.reportError);
  env.worker.postMessage = () => { throw new Error('Worker beendet'); };
  env.button.click();
  assert.match(env.errors[0], /nicht aktiviert.*Worker beendet/);
  assert.equal(env.button.disabled, false);
  env.registration.waiting = null;
  env.button.click();
  assert.match(env.errors[1], /nicht mehr verfügbar/);
  assert.equal(env.reloads, 0);
});

test('Nicht unterstützte Browser werden ausgelassen; Registrierungsfehler bleiben sichtbar', async (t) => {
  const env = environment(t);
  delete env.navigator.serviceWorker;
  await initUpdates(env.reportError);
  assert.equal(env.registrations.length, 0);
  env.navigator.serviceWorker = env.serviceWorker;
  env.serviceWorker.register = async () => { throw new Error('Registrierung fehlgeschlagen'); };
  await assert.rejects(initUpdates(env.reportError), /Registrierung fehlgeschlagen/);
});

test('Service Worker lädt neue App-Dateien ohne alten HTTP-Cache und aktiviert nur auf Nachricht', async () => {
  const handlers = {};
  let requests;
  let activations = 0;
  const self = {
    registration: { scope: 'https://example.test/eisfach/' },
    addEventListener: (type, handler) => { handlers[type] = handler; },
    skipWaiting: async () => { activations++; },
  };
  runInNewContext(await readFile(new URL('../service-worker.js', import.meta.url), 'utf8'), {
    self, URL, Request,
    caches: { open: async () => ({ addAll: async (entries) => { requests = entries; } }) },
  });
  let pending;
  const waitUntil = (promise) => { pending = promise; };
  handlers.install({ waitUntil });
  await pending;
  assert.ok(requests.some((request) => request.url.endsWith('/js/updates.js')));
  assert.ok(requests.every((request) => request.cache === 'reload'));
  assert.equal(activations, 0);
  handlers.message({ data: null, waitUntil });
  handlers.message({ data: { type: 'OTHER' }, waitUntil });
  assert.equal(activations, 0);
  handlers.message({ data: { type: 'SKIP_WAITING' }, waitUntil });
  await pending;
  assert.equal(activations, 1);
});
