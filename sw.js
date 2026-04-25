const CACHE = 'leads-v6';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('googleapis.com') ||
      e.request.url.includes('fonts.google')) return;
  e.respondWith(
    fetch(e.request).catch(() => new Response('offline', {status: 503}))
  );
});
