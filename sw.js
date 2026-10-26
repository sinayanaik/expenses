const VERSION = 'v1';                      // the Pages workflow replaces this with the commit hash on deploy; bump by hand on other hosts
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/db.js', './js/seed.js', './js/supabase.js', './js/sync.js',
  './js/parser/parse.js', './js/parser/resolve.js',
  './js/ui/dom.js', './js/ui/install.js', './js/ui/add.js', './js/ui/list.js', './js/ui/stats.js', './js/ui/settings.js',
  './icons/icon.svg', './icons/icon-maskable.svg',
];

self.addEventListener('install', e => e.waitUntil(
  caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));

self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.hostname.endsWith('supabase.co')) return;   // never cache API or login

  if (url.hostname === 'cdn.jsdelivr.net') {                                  // pinned libraries: cache-first
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(req, copy));
      return res;
    })));
    return;
  }
  if (url.origin === location.origin) {                                       // app shell, works offline
    const nav = req.mode === 'navigate';                                      // "./?text=..." from share target
    e.respondWith(caches.match(nav ? './index.html' : req).then(hit => hit || fetch(req)));
  }
});
