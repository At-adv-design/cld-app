// Service worker for the INSOLVENCY app
const CACHE_NAME = 'at-insolvency-v6';
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

  if (isLiveDataHost(url)) {
    event.respondWith(fetch(req));
    return;
  }

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

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => cached))
  );
});
