const CACHE = 'eisfach-shell-v22';
const SHELL = [
  './', './index.html', './setup.html', './app.html', './devices.html', './freezer.html', './sorting.html', './appearance.html', './transfer.html',
  './css/app.css', './js/config.js', './js/supabase.js', './js/auth.js',
  './js/storage.js', './js/zip.js', './js/setup.js', './js/scanner.js', './js/inventory.js',
  './js/devices.js', './js/freezer.js', './js/locations.js', './js/ordering.js', './js/sorting.js', './js/appearance.js', './js/transfer.js', './js/app.js', './manifest.json', './assets/icon.svg',
  './assets/vendor/qrcode.js', './assets/vendor/jsQR.js',
];
const shellURLs = new Set(SHELL.map((path) => new URL(path, self.registration.scope).href));

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith('eisfach-shell-') && key !== CACHE).map((key) => caches.delete(key)),
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const shellURL = new URL(url.href);
  shellURL.search = '';
  const shell = shellURLs.has(shellURL.href);
  // Niemals API-Antworten, Tokens oder private Bilder im Service Worker speichern.
  if (!shell) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = shell ? shellURL.href : request;
    const cached = await cache.match(key);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type !== 'opaque') await cache.put(key, response.clone());
    return response;
  })());
});
