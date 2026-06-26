/* Service worker — офлайн-кэш приложения CASHFLOW.
   Стратегия: cache-first для своих файлов. Бампать CACHE при изменении ассетов. */
const CACHE = 'cashflow-v6';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css?v=6',
  './js/data.js?v=6',
  './js/game.js?v=6',
  './manifest.json',
  './icon.png',
  './icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        // докэшируем успешные ответы того же origin
        if (res.ok && e.request.url.startsWith(self.location.origin)) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
