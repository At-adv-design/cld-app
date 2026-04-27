// Service worker for the LEADS app
// IMPORTANT: bumping the cache name forces a refresh on every device.
const CACHE_NAME = 'at-leads-v6';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  '../logo.png',
  '../icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Hosts whose responses must NEVER be cached — always fetch fresh from the network.
function isLiveDataHost(url) {
  return (
    url.includes('googleapis.com') ||
    url.includes('google.com/oauth') ||
    url.includes('accounts.google.com') ||
    url.includes('googleusercontent.com')
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = req.url;

  // 1) Live data — bypass cache entirely. Always go to the network.
  if (isLiveDataHost(url)) {
    event.respondWith(fetch(req));
    return;
  }

  // 2) HTML navigations — network-first so code updates are picked up quickly.
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((m) => m || caches.match('./index.html')))
    );
    return;
  }

  // 3) Static assets (logo, icon, manifest) — cache-first.
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => cached))
  );
});
