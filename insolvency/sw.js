// Service worker for the INSOLVENCY app ׳³ג€™׳’ג€ֲ¬׳’ג‚¬ֲ aggressive auto-update.
const CACHE_NAME = 'at-insolvency-v172';
const ASSETS = [
  './manifest.json',
  '../logo.png',
  '../icon.png'
];

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      ),
      self.clients.claim(),
    ])
  );
});

function isLiveDataHost(url) {
  return (
    url.includes('googleapis.com') ||
    url.includes('script.google.com') ||
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

  const isHtml = req.mode === 'navigate' ||
                 (req.headers.get('accept') || '').includes('text/html') ||
                 url.endsWith('/') || url.endsWith('/index.html');
  if (isHtml) {
    event.respondWith((async () => {
      try {
        const u = new URL(req.url);
        u.searchParams.set('_sw', Date.now().toString(36));
        const fresh = await fetch(u.toString(), {cache:'no-store'});
        if (fresh && fresh.ok) {
          const copy = fresh.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          return fresh;
        }
      } catch(_) {}
      const cached = await caches.match(req);
      return cached || caches.match('./index.html');
    })());
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const fetcher = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || fetcher;
    })
  );
});
