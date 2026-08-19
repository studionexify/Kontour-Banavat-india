/* Phynance service worker — offline cache for the app shell.
 *
 * Network-first, cache-fallback. Cache-first would be marginally faster, but
 * it silently serves stale code the moment a file changes — during a build
 * that is a trap, and after deploying to the subdomain it means the phone
 * keeps running last week's app. Online you always get the current files;
 * offline you get the last ones that worked.
 *
 * Note: service workers only register on a secure context (https:// or
 * http://localhost). Over a plain LAN address the browser refuses, which is
 * expected — see README, "Running it".
 */

const CACHE = 'phynance-v2';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './css/styles.css',
  './js/app.js', './js/store.js', './js/db.js', './js/format.js',
  './js/icons.js', './js/ui.js', './js/photos.js', './js/sync.js', './js/export.js',
  './js/views/home.js', './js/views/entry.js', './js/views/ledger.js',
  './js/views/jobs.js', './js/views/reports.js', './js/views/settings.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => {})          // a missing file must not block activation
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
  );
});

/* Lets the page force an update without the user clearing site data. */
self.addEventListener('message', (e) => {
  if (e.data === 'phynance:update') self.skipWaiting();
});
