// Offline support: cache the app's own static files on first visit. Requests go to the network
// first (so a redeploy is picked up at once) and fall back to the cache when offline.
// Only same-origin GET requests for these files are handled; nothing else is fetched or stored.
const CACHE = 'whencode-v1';
const FILES = [
  './', 'index.html', 'css/app.css', 'icon.svg', 'manifest.webmanifest',
  'js/app.js', 'js/tz.js', 'js/plan.js', 'js/codec.js', 'js/ics-import.js', 'js/merge.js',
  'js/ics-export.js', 'js/grid.js', 'js/qr.js', 'js/samples.js',
  'vendor/ical.min.js', 'vendor/qrcode.mjs',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))),
  );
});
