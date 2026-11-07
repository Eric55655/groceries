/* Service worker: lets the app open with no signal.
   Strategy: when online, always get the newest files (falls back to the saved copy
   after 4 seconds or when offline). Bump VERSION whenever you upload changed files. */
var VERSION = 'grocery-v4';
var ASSETS = ['./', './index.html', './styles.css', './app.js', './shared.js', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (cache) {
    return Promise.all(ASSETS.map(function (u) {
      // cache: 'reload' skips the browser's HTTP cache so we never save stale files
      return fetch(u, { cache: 'reload' }).then(function (res) {
        if (!res.ok) throw new Error('Could not fetch ' + u);
        return cache.put(u, res);
      });
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  var url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // API calls go straight to network
  var key = req.mode === 'navigate' ? './index.html' : url.pathname;

  e.respondWith(caches.open(VERSION).then(function (cache) {
    var fromCache = function () {
      return cache.match(key, { ignoreSearch: true }).then(function (hit) { return hit || Response.error(); });
    };
    var network = fetch(url.origin + url.pathname, { cache: 'no-cache' }).then(function (res) {
      if (res && res.ok) cache.put(key, res.clone());
      return res;
    });
    var timeout = new Promise(function (_, reject) { setTimeout(function () { reject(new Error('slow')); }, 4000); });
    return Promise.race([network, timeout]).catch(fromCache);
  }));
});
