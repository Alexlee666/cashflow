/* Service worker — офлайн-кэш CASHFLOW.
   Стратегия: NETWORK-FIRST (сначала сеть, кэш — запасной для офлайна).
   Так свежая версия подхватывается сразу, а без интернета игра всё равно открывается. */
const CACHE = 'cashflow-v13';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css?v=11',
  './js/data.js?v=11',
  './js/game.js?v=11',
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
    fetch(e.request)
      .then((res) => {
        // обновляем кэш свежим ответом своего origin
        if (res && res.ok && e.request.url.startsWith(self.location.origin)) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
  );
});
