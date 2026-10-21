// Service worker: la app abre sin señal y los planos ya vistos quedan guardados.
const VERSION = 'v1';
const BASE = ['./', 'index.html', 'app.js', 'estilos.css', 'vendor/leaflet.js', 'vendor/leaflet.css',
  'datos/manifest.json', 'manifest.webmanifest', 'iconos/icono-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open('base-' + VERSION).then(c => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(
    ks.filter(k => k.startsWith('base-') && k !== 'base-' + VERSION).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Tiles y fuentes no cambian: primero caché.
  if (url.pathname.includes('/datos/tiles/') || url.pathname.includes('/datos/detalles/') ||
      url.host.includes('fonts.g')) {
    e.respondWith(caches.open('planos').then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }
  // Código y datos: primero red (así llegan las mejoras), caché si no hay señal.
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) caches.open('base-' + VERSION).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
  }
});
