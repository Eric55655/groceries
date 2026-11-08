/* Service worker: lets the app open with no signal, and shows notifications.
   Strategy: when online, always get the newest files (falls back to the saved copy
   after 4 seconds or when offline). Bump VERSION whenever you upload changed files. */
var VERSION = 'grocery-v6';
var ASSETS = ['./', './index.html', './styles.css', './app.js', './shared.js', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/badge-96.png'];

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

// ------------------------------------------------------------------ notifications
// The server sends an empty "wake up" push; we ask it what changed and show one summary notification.
self.addEventListener('push', function (e) { e.waitUntil(handlePush()); });

function handlePush() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (wins) {
    var visible = wins.filter(function (w) { return w.visibilityState === 'visible'; });
    if (visible.length) { visible.forEach(function (w) { w.postMessage({ type: 'sync' }); }); return; }  // app is open: just refresh it
    return Promise.all([idbGet('cfg'), idbGet('seenAt')]).then(function (v) {
      var cfg = v[0], since = v[1] || new Date(Date.now() - 3600 * 1000).toISOString();
      if (!cfg) return [];
      return fetch(cfg.api + '?action=events&token=' + encodeURIComponent(cfg.token) + '&since=' + encodeURIComponent(since))
        .then(function (r) { return r.json(); })
        .then(function (j) { return (j && j.ok && j.events) || []; })
        .catch(function () { return []; });
    }).then(function (events) {
      var n = summarize(events);
      return self.registration.showNotification(n.title, {
        body: n.body, tag: 'grocery', renotify: n.loud, silent: !n.loud,
        icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: { url: './' }
      });
    });
  });
}

function summarize(events) {
  var trips = events.filter(function (e) { return e.type === 'trip'; });
  var adds = events.filter(function (e) { return e.type === 'add'; });
  var bought = events.filter(function (e) { return e.type === 'bought'; });
  var tests = events.filter(function (e) { return e.type === 'test'; });
  var lines = [];
  // "Mary added milk, eggs and 3 more"
  var byPerson = {};
  adds.forEach(function (e) { (byPerson[e.person] = byPerson[e.person] || []).push(e.details.toLowerCase()); });
  Object.keys(byPerson).forEach(function (p) {
    var names = byPerson[p].filter(function (x, i, a) { return a.indexOf(x) === i; });
    var shown = names.slice(0, 4).join(', ') + (names.length > 4 ? ' and ' + (names.length - 4) + ' more' : '');
    lines.push(p + ' added ' + shown);
  });
  var boughtBy = {};
  bought.forEach(function (e) { boughtBy[e.person] = (boughtBy[e.person] || 0) + 1; });
  Object.keys(boughtBy).forEach(function (p) {
    lines.push(p + ' checked off ' + boughtBy[p] + ' item' + (boughtBy[p] > 1 ? 's' : ''));
  });
  tests.forEach(function (e) { lines.push(e.details); });
  if (trips.length) {
    var t = trips[trips.length - 1];
    return { title: '🛒 ' + t.person + ' is shopping' + (t.details ? ' at ' + t.details : '') + ' — add anything now',
      body: lines.join('\n') || 'Tap to open the list.', loud: true };
  }
  if (!lines.length) return { title: 'Grocery list', body: 'The list was updated.', loud: false };
  return { title: 'Grocery list', body: lines.join('\n'), loud: adds.length > 0 || tests.length > 0 };
}

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (wins) {
    for (var i = 0; i < wins.length; i++) if ('focus' in wins[i]) return wins[i].focus();
    return self.clients.openWindow('./');
  }));
});

function idbGet(k) {
  return new Promise(function (res) {
    var r = indexedDB.open('grocery', 1);
    r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
    r.onerror = function () { res(null); };
    r.onsuccess = function () {
      try {
        var g = r.result.transaction('kv').objectStore('kv').get(k);
        g.onsuccess = function () { res(g.result); }; g.onerror = function () { res(null); };
      } catch (e) { res(null); }
    };
  });
}
