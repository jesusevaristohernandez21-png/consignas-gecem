const CACHE = 'consignas-gecem-v2-8-2';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // El servidor (Apps Script) y las fotos de Drive nunca se cachean
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    // Primero la copia guardada: con datos móviles la red a veces no falla,
    // se queda colgada, y sin tope la app se quedaba en blanco.
    const guardada = await caches.match(req);
    const red = fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); }
      return res;
    }).catch(() => null);
    if (guardada) {
      // Ya hay copia: si la red no responde en 3 s, se usa la copia y la red sigue actualizando por detrás
      const tope = new Promise(r => setTimeout(() => r(null), 3000));
      const primero = await Promise.race([red, tope]);
      return primero || guardada;
    }
    // Sin copia (primera vez): hay que ir a la red
    const res = await red;
    return res || caches.match('./index.html');
  })());
});
