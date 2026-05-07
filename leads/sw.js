// Service worker for the LEADS app ׳’ג‚¬ג€ aggressive auto-update.
// Strategy:
//   - Bump CACHE_NAME on every release. Old caches are wiped on activate.
//   - HTML: network-first with cache-bust. New code shows up immediately
//     after a refresh ׳’ג‚¬ג€ never serve stale HTML from cache.
//   - Static assets (icons, manifest): cache-first but updated in the background.
//   - On message {type:'SKIP_WAITING'} we activate immediately.
//   - clients.claim() in activate so the new SW takes over open tabs.
const CACHE_NAME = 'at-leads-v96';
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
  // Activate immediately ׳’ג‚¬ג€ don't wait for old tabs to close
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // Wipe every cache that isn't the current one
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      ),
      // Take control of any already-loaded tabs immediately
      self.clients.claim(),
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const leadIdx = data.leadIdx;
  const phone = (data.phone || '').replace(/[^0-9+]/g, '');

  if (event.action === 'call' && phone) {
    event.waitUntil((async () => {
      try {
        const wins = await clients.matchAll({type:'window', includeUncontrolled:true});
        for (const c of wins) {
          if ('focus' in c) {
            try { c.postMessage({kind:'open-lead', leadIdx}); } catch(_){}
            break;
          }
        }
      } catch(_){}
      try { await clients.openWindow('tel:' + phone); } catch(_){}
    })());
    return;
  }
  event.waitUntil(
    clients.matchAll({type:'window', includeUncontrolled:true}).then((wins) => {
      for (const client of wins) {
        if ('focus' in client) {
          if (leadIdx) client.postMessage({kind:'open-lead', leadIdx});
          return client.focus();
        }
      }
      const url = leadIdx ? `./#lead=${leadIdx}` : './';
      return clients.openWindow(url);
    })
  );
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

  // Live data ׳’ג‚¬ג€ never cache
  if (isLiveDataHost(url)) {
    event.respondWith(fetch(req));
    return;
  }

  // HTML / navigation ׳’ג‚¬ג€ ALWAYS network-first with cache-bust query.
  // We append a unique parameter to the URL so the browser's HTTP cache
  // can't return a stale version. If the network fails, fall back to
  // the cached copy.
  const isHtml = req.mode === 'navigate' ||
                 (req.headers.get('accept') || '').includes('text/html') ||
                 url.endsWith('/') || url.endsWith('/index.html');
  if (isHtml) {
    event.respondWith((async () => {
      try {
        // Build a cache-busted URL: foo.html?_sw=12345
        const u = new URL(req.url);
        u.searchParams.set('_sw', Date.now().toString(36));
        const fresh = await fetch(u.toString(), {cache:'no-store'});
        if (fresh && fresh.ok) {
          // Cache a copy WITHOUT the cache-bust param so future cache.match works.
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

  // Other static assets ׳’ג‚¬ג€ cache-first, update in background
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
