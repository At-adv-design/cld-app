// Service worker for the LEADS app
// IMPORTANT: bumping the cache name forces a refresh on every device.
const CACHE_NAME = 'at-leads-v42';
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

// When the user taps a reminder notification we open (or focus) the app.
// "התקשר" action: open tel: DIRECTLY via clients.openWindow — this is what
// reliably triggers the Android dialer from a notification. After the dialer
// hand-off, we also send a postMessage so when the user returns to the app
// after the call, the call-summary modal is already open with the action
// buttons (continue/meeting/reminder/remove).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const leadIdx = data.leadIdx;
  const phone = (data.phone || '').replace(/[^0-9+]/g, '');

  if (event.action === 'call' && phone) {
    event.waitUntil((async () => {
      // Tell the app to pre-open the call-summary modal so it's ready when
      // the user finishes the call. Do this BEFORE the tel: hand-off.
      try {
        const wins = await clients.matchAll({type:'window', includeUncontrolled:true});
        for (const c of wins) {
          if ('focus' in c) {
            try { c.postMessage({kind:'open-lead', leadIdx}); } catch(_){}
            break;
          }
        }
      } catch(_){}
      // Now launch the dialer. clients.openWindow with a tel: URL is the only
      // reliable path from a service worker notificationclick on Android.
      try { await clients.openWindow('tel:' + phone); } catch(_){}
    })());
    return;
  }
  // Default click (or "open" action) → focus / open the app on this lead
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
