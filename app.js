/* Grocery List — phone app (works offline; syncs to the Google Sheet backend) */
(function () {
  'use strict';
  var APP_VERSION = 6;   // shown in the ⋯ menu so you can confirm a phone has the latest update

  // ---------------------------------------------------------------- storage
  var K = { cfg: 'gl.cfg', items: 'gl.items', outbox: 'gl.outbox', trip: 'gl.trip', recent: 'gl.recent',
    learned: 'gl.learned', view: 'gl.view', synced: 'gl.synced', stores: 'gl.stores', filter: 'gl.filter', vapid: 'gl.vapid' };
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  var cfg = load(K.cfg, null);   // { api, token, person, device }
  var S = {
    items: load(K.items, []), outbox: load(K.outbox, []), trip: load(K.trip, null),
    recent: load(K.recent, []), learned: load(K.learned, {}), view: load(K.view, 'list'),
    lastSync: load(K.synced, null), syncing: false, error: null, alias: {},
    stores: load(K.stores, []), filter: load(K.filter, ''), vapidKey: load(K.vapid, '')
  };
  function persist() {
    save(K.items, S.items); save(K.outbox, S.outbox); save(K.trip, S.trip); save(K.recent, S.recent);
    save(K.learned, S.learned); save(K.view, S.view); save(K.synced, S.lastSync);
    save(K.stores, S.stores); save(K.filter, S.filter); save(K.vapid, S.vapidKey);
  }
  function storeNames() { return S.stores.map(function (s) { return s.name; }); }
  function findStore(name) {
    var m = name ? glMatchStore(name, storeNames()) : null;
    return m ? S.stores.filter(function (s) { return s.name === m; })[0] : null;
  }
  function inStore(item, storeName) {   // items with no store tag can be bought anywhere
    var st = item.stores || [];
    return !storeName || !st.length || st.indexOf(storeName) >= 0;
  }

  var $ = function (sel, root) { return (root || document).querySelector(sel); };

  // ---------------------------------------------------------------- display settings (saved per phone)
  var THEMES = [
    { name: 'Green', c: '#1f7a4d' }, { name: 'Blue', c: '#1d5fbf' }, { name: 'Teal', c: '#0f766e' },
    { name: 'Purple', c: '#6d3fc0' }, { name: 'Pink', c: '#c2306f' }, { name: 'Red', c: '#c0392b' },
    { name: 'Orange', c: '#d9620f' }, { name: 'Gold', c: '#e0b20b' }, { name: 'Brown', c: '#7a4e2d' },
    { name: 'Slate', c: '#3f4c5a' }, { name: 'Black', c: '#1b1b1b' }
  ];
  var SIZES = [
    { name: 'Small', v: 0.9 }, { name: 'Normal', v: 1 }, { name: 'Large', v: 1.15 },
    { name: 'X-Large', v: 1.3 }, { name: 'Huge', v: 1.5 }
  ];
  var prefs = load('gl.prefs', { color: '#1f7a4d', mode: 'auto', size: 1 });

  function hexToRgb(h) {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h.split('').map(function (x) { return x + x; }).join('');
    var n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(hex, withHex, amount) {   // amount 0..1 of withHex
    var a = hexToRgb(hex), b = hexToRgb(withHex);
    return '#' + a.map(function (x, i) {
      return ('0' + Math.round(x + (b[i] - x) * amount).toString(16)).slice(-2);
    }).join('');
  }
  function luminance(hex) {
    var c = hexToRgb(hex).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function applyPrefs() {
    var r = document.documentElement, c = prefs.color || '#1f7a4d';
    var light = luminance(c) > 0.4;   // light colours (yellow etc.) get dark text
    r.style.setProperty('--accent', c);
    r.style.setProperty('--accent-d', mix(c, '#000000', 0.2));
    r.style.setProperty('--on-accent', light ? '#16181a' : '#ffffff');
    r.style.setProperty('--on-accent-soft', light ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.2)');
    r.style.setProperty('--accent-tint', mix(c, '#ffffff', 0.88));
    r.style.setProperty('--accent-tint-dark', mix(c, '#121614', 0.72));
    r.style.setProperty('--accent-text', light ? mix(c, '#000000', 0.45) : c);
    r.style.setProperty('--accent-text-dark', mix(c, '#ffffff', 0.45));
    r.style.setProperty('--accent-bright', light ? mix(c, '#000000', 0.35) : mix(c, '#ffffff', 0.5));
    r.style.setProperty('--fs', String(prefs.size || 1));
    if (prefs.mode === 'auto') r.removeAttribute('data-mode'); else r.setAttribute('data-mode', prefs.mode);
    var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', c);
  }
  applyPrefs();

  function showSettings() {
    var custom = !THEMES.some(function (t) { return t.c === prefs.color; });
    openDialog(
      '<h2>Display settings</h2>' +
      '<div class="set-label">Color</div><div class="swatches">' +
      THEMES.map(function (t) {
        return '<button class="swatch' + (t.c === prefs.color ? ' on' : '') + '" data-color="' + t.c +
          '" style="background:' + t.c + '" aria-label="' + t.name + '" title="' + t.name + '"></button>';
      }).join('') +
      '<label class="swatch custom' + (custom ? ' on' : '') + '" title="Pick any color">' +
      '<input type="color" id="customColor" value="' + esc(prefs.color) + '" aria-label="Custom color"></label></div>' +
      '<div class="set-label">Light or dark</div><div class="seg" id="modeSeg">' +
      [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(function (m) {
        return '<button data-mode="' + m[0] + '" class="' + (prefs.mode === m[0] ? 'on' : '') + '">' + m[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="set-label">Text size</div><div class="seg sizes" id="sizeSeg">' +
      SIZES.map(function (s) {
        return '<button data-size="' + s.v + '" class="' + (prefs.size === s.v ? 'on' : '') + '" aria-label="' + s.name + '">' +
          '<span style="font-size:' + Math.round(15 * s.v) + 'px">A</span><small>' + s.name + '</small></button>';
      }).join('') + '</div>' +
      '<div class="sample"><span class="name">Milk <span class="qty">2 gallons</span></span><br><span class="meta">Eric · Pixel 8 · Today 9:41 AM</span></div>' +
      '<div class="dlg-actions"><button class="btn ghost" id="setReset">Reset</button><span class="grow"></span>' +
      '<button class="btn primary" data-close>Done</button></div>',
      function (dlg) {
        function update(ch) {
          for (var k in ch) prefs[k] = ch[k];
          save('gl.prefs', prefs); applyPrefs(); showSettings();
        }
        dlg.querySelectorAll('[data-color]').forEach(function (b) { b.onclick = function () { update({ color: b.dataset.color }); }; });
        $('#customColor', dlg).onchange = function () { update({ color: this.value }); };
        $('#customColor', dlg).oninput = function () { prefs.color = this.value; applyPrefs(); };
        dlg.querySelectorAll('[data-mode]').forEach(function (b) { b.onclick = function () { update({ mode: b.dataset.mode }); }; });
        dlg.querySelectorAll('[data-size]').forEach(function (b) { b.onclick = function () { update({ size: parseFloat(b.dataset.size) }); }; });
        $('#setReset', dlg).onclick = function () { update({ color: '#1f7a4d', mode: 'auto', size: 1 }); };
      });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function me() { return (cfg && cfg.person) || 'Me'; }

  // ---------------------------------------------------------------- setup link (#api=...&token=...)
  function parseSetup(str) {
    str = String(str || '').trim();
    var i = str.indexOf('#'); var h = i >= 0 ? str.slice(i + 1) : str;
    var p = new URLSearchParams(h);
    if (p.get('api') && p.get('token')) return { api: p.get('api'), token: p.get('token') };
    return null;
  }
  (function readHash() {
    var c = parseSetup(location.hash);
    if (c) {
      if (!cfg || cfg.token !== c.token) { resetLocal(); }
      cfg = c; save(K.cfg, cfg);
      history.replaceState(null, '', location.pathname + location.search);
      setTimeout(function () { idbSet('cfg', { api: cfg.api, token: cfg.token }); }, 0);
    }
  })();
  function resetLocal() {
    S.items = []; S.outbox = []; S.trip = null; S.recent = []; S.learned = {}; S.view = 'list'; S.lastSync = null;
    S.stores = []; S.filter = '';
    persist();
  }

  // ---------------------------------------------------------------- local changes (applied instantly, synced later)
  function findItem(id) {
    id = S.alias[id] || id;
    for (var i = 0; i < S.items.length; i++) if (S.items[i].id === id) return S.items[i];
    return null;
  }

  function queue(op) {
    op.at = op.at || new Date().toISOString();
    S.outbox.push(op);
    applyLocal(op);
    persist(); render(); scheduleSync();
  }

  function applyLocal(op) {
    var it;
    switch (op.op) {
      case 'add': {
        if (findItem(op.id)) return;
        var key = glKey(op.item);
        var dup = S.items.filter(function (i) { return i.status === 'open' && glKey(i.item) === key; })[0];
        if (dup) { dup.qty = glMergeQty(dup.qty, op.qty); S.alias[op.id] = dup.id; return; }
        S.items.push({ id: op.id, item: glTitle(op.item), qty: op.qty || '', notes: op.notes || '', stores: op.stores || [],
          category: glCategorize(op.item, S.learned), status: 'open', added_by: me(),
          added_device: (cfg && cfg.device) || '', added_at: op.at, pending: true });
        return;
      }
      case 'update':
        it = findItem(op.id); if (!it) return;
        if (op.item != null && String(op.item).trim()) it.item = glTitle(op.item);
        if (op.qty != null) it.qty = op.qty;
        if (op.notes != null) it.notes = op.notes;
        if (op.stores != null) it.stores = op.stores;
        if (op.category) { it.category = op.category; S.learned[glKey(it.item)] = op.category; }
        return;
      case 'delete':
        it = findItem(op.id); if (!it) return;
        S.items = S.items.filter(function (i) { return i !== it; });
        return;
      case 'check':
        it = findItem(op.id); if (!it) return;
        if (op.bought) { it.status = 'bought'; it.bought_by = me(); it.bought_at = op.at; it.trip_id = S.trip ? S.trip.trip_id : ''; }
        else { it.status = 'open'; it.bought_by = ''; it.bought_at = ''; it.trip_id = ''; }
        return;
      case 'startTrip':
        if (!S.trip) S.trip = { trip_id: op.tripId, started_by: me(), started_device: (cfg && cfg.device) || '', started_at: op.at, store: op.store || '' };
        return;
      case 'addStore':
        if (op.name && !findStore(op.name)) S.stores.push({ name: glTitle(op.name), learn: true, catRank: {}, itemRank: {}, trips: 0 });
        return;
      case 'renameStore': {
        var rs = findStore(op.from); if (!rs || !op.to) return;
        var old = rs.name; rs.name = glTitle(op.to);
        S.items.forEach(function (i) { i.stores = (i.stores || []).map(function (x) { return x === old ? rs.name : x; }); });
        if (S.filter === old) S.filter = rs.name;
        return;
      }
      case 'deleteStore': {
        var ds = findStore(op.name); if (!ds) return;
        S.stores = S.stores.filter(function (x) { return x !== ds; });
        S.items.forEach(function (i) { i.stores = (i.stores || []).filter(function (x) { return x !== ds.name; }); });
        if (S.filter === ds.name) S.filter = '';
        return;
      }
      case 'setStoreOrder': {
        var os = findStore(op.name); if (!os) return;
        os.catRank = {}; op.order.forEach(function (c, i) { os.catRank[c] = i; });
        return;
      }
      case 'setStoreLearn': { var ls = findStore(op.name); if (ls) ls.learn = !!op.learn; return; }
      case 'setPrefs':
        cfg.prefs = cfg.prefs || {};
        ['n_add', 'n_bought', 'n_trip', 'announce_trip'].forEach(function (k) { if (op[k] != null) cfg.prefs[k] = !!op[k]; });
        return;
      case 'subscribe': cfg.push = true; return;
      case 'unsubscribe': cfg.push = false; return;
      case 'finishTrip':
        S.items = S.items.filter(function (i) { return i.status !== 'bought'; });
        S.trip = null;
        return;
    }
  }

  // ---------------------------------------------------------------- sync with the Google Sheet
  var syncTimer = null;
  function scheduleSync(ms) { clearTimeout(syncTimer); syncTimer = setTimeout(sync, ms == null ? 300 : ms); }

  function post(payload) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 25000);
    return fetch(cfg.api, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload), redirect: 'follow', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).finally(function () { clearTimeout(timer); });
  }

  function sync() {
    if (!cfg) return Promise.resolve();
    if (S.syncing) { S.resync = true; return Promise.resolve(); }
    S.syncing = true; renderStatus();
    var sending = S.outbox.slice(0, 100);
    return post({ token: cfg.token, ops: sending }).then(function (res) {
      if (!res || !res.ok) {
        if (res && res.error === 'unauthorized') { S.error = 'unauthorized'; return; }
        throw new Error((res && res.message) || 'Server error');
      }
      S.outbox.splice(0, sending.length);
      if (res.who) {
        cfg.person = res.who.person; cfg.device = res.who.device;
        if (res.who.prefs) cfg.prefs = res.who.prefs;
        cfg.push = !!res.who.push; save(K.cfg, cfg);
      }
      applySnapshot(res.snapshot);
      S.lastSync = new Date().toISOString();
      S.error = null;
    }).catch(function () {
      S.error = navigator.onLine === false ? 'offline' : 'unreachable';
    }).then(function () {
      S.syncing = false;
      persist(); render();
      if (S.error === 'unauthorized') return;
      if (S.resync || (S.outbox.length && !S.error)) { S.resync = false; scheduleSync(200); }
    });
  }

  function applySnapshot(snap) {
    if (!snap) return;
    var wasShopping = S.view === 'shop';
    S.items = snap.items || [];
    S.trip = snap.activeTrip || null;
    S.recent = snap.recent || [];
    S.learned = snap.learned || {};
    S.stores = snap.stores || S.stores;
    if (snap.vapidKey) S.vapidKey = snap.vapidKey;
    if (S.filter && !findStore(S.filter)) S.filter = '';
    S.alias = {};
    S.outbox.forEach(applyLocal);   // re-apply changes the server hasn't seen yet
    if (cfg.prefs) S.outbox.forEach(function (op) { if (op.op === 'setPrefs') applyLocal(op); });
    autoResubscribe();
    if (wasShopping && !S.trip) {
      S.view = 'list';
      toast('The shopping trip was finished on another phone.');
    }
  }

  // ---------------------------------------------------------------- actions
  function addFromText(text) {
    var parsed = glParseItems(text, storeNames());
    if (!parsed.length) return;
    var ids = parsed.map(function (p) {
      var id = glId();
      var stores = p.stores.length ? p.stores : (S.view === 'list' && S.filter ? [S.filter] : []);
      queue({ op: 'add', id: id, item: p.item, qty: p.qty, stores: stores });
      return id;
    });
    toast('Added ' + parsed.map(function (p) { return p.item.toLowerCase(); }).join(', '), 'Undo', function () {
      ids.forEach(function (id) { if (findItem(id) && !S.alias[id]) queue({ op: 'delete', id: id }); });
    });
  }

  function enterShop(storeName) {
    var open = S.items.filter(function (i) { return i.status === 'open'; });
    if (!open.length && !S.trip) { toast('The list is empty.'); return; }
    if (!S.trip) {
      if (storeName == null && S.stores.length > 1) return pickStore(open);
      if (storeName == null) storeName = S.stores[0] ? S.stores[0].name : '';
      queue({ op: 'startTrip', tripId: 'T' + glId(), store: storeName });
    }
    S.view = 'shop'; persist(); render(); window.scrollTo(0, 0); keepAwake(true);
  }
  function pickStore(open) {
    openDialog('<h2>Where are you shopping?</h2><div class="store-pick">' +
      S.stores.map(function (st) {
        var n = open.filter(function (i) { return inStore(i, st.name); }).length;
        return '<button class="btn wide" data-store="' + esc(st.name) + '"><b>' + esc(st.name) + '</b><small>' + n + ' item' + (n === 1 ? '' : 's') + '</small></button>';
      }).join('') + '</div>' +
      '<p class="meta">Everyone else gets a “' + esc(me()) + ' is shopping” alert' + (cfg.prefs && cfg.prefs.announce_trip === false ? ' — <b>turned off</b> in 🔔 Notifications' : '') + '.</p>' +
      '<div class="dlg-actions"><span class="grow"></span><button class="btn ghost" data-close>Cancel</button></div>',
      function (dlg) {
        dlg.querySelectorAll('[data-store]').forEach(function (b) {
          b.onclick = function () { closeDialog(); enterShop(b.getAttribute('data-store')); };
        });
      });
  }
  function leaveShop() { S.view = 'list'; persist(); render(); keepAwake(false); }

  function finishTrip() {
    var here = S.trip ? S.trip.store : '';
    var bought = S.items.filter(function (i) { return i.status === 'bought'; }).length;
    var left = S.items.filter(function (i) { return i.status === 'open' && inStore(i, here); }).length;
    openDialog(
      '<h2>Finish shopping?</h2>' +
      '<p>' + bought + ' bought.' + (left ? ' <b>' + left + ' not bought</b> will stay on the list for next time.' : ' Everything was bought!') + '</p>' +
      '<div class="dlg-actions"><button class="btn ghost" data-close>Keep shopping</button>' +
      '<button class="btn primary" id="confirmFinish">Finish trip</button></div>',
      function (dlg) {
        $('#confirmFinish', dlg).onclick = function () {
          closeDialog();
          queue({ op: 'finishTrip', tripId: S.trip ? S.trip.trip_id : '' });
          S.view = 'list'; persist(); render(); keepAwake(false);
          toast(left ? left + ' item' + (left > 1 ? 's' : '') + ' carried over to next time.' : 'Trip finished.');
        };
      });
  }

  function editItem(id) {
    var it = findItem(id); if (!it) return;
    var opts = GL_CATEGORIES.map(function (c) {
      return '<option' + (c === it.category ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    openDialog(
      '<h2>Edit item</h2>' +
      '<label>Item<input id="eName" value="' + esc(it.item) + '" autocomplete="off"></label>' +
      '<label>Quantity<input id="eQty" value="' + esc(it.qty) + '" placeholder="e.g. 2, 1 gallon" autocomplete="off"></label>' +
      '<label>Notes<input id="eNotes" value="' + esc(it.notes) + '" placeholder="brand, size…" autocomplete="off"></label>' +
      '<label>Aisle / category<select id="eCat">' + opts + '</select></label>' +
      (S.stores.length > 1 ? '<div class="dlg-label">Where to buy it <small>(none = any store)</small></div><div class="store-tags">' +
        S.stores.map(function (st) {
          return '<label class="tag-check"><input type="checkbox" value="' + esc(st.name) + '"' +
            ((it.stores || []).indexOf(st.name) >= 0 ? ' checked' : '') + '> ' + esc(st.name) + '</label>';
        }).join('') + '</div>' : '') +
      '<p class="meta">Added by ' + esc(it.added_by) + (it.added_device ? ' · ' + esc(it.added_device) : '') +
      ' · ' + esc(when(it.added_at)) + (it.also_added_by ? '<br>Also added by ' + esc(it.also_added_by) : '') + '</p>' +
      '<div class="dlg-actions"><button class="btn danger" id="eDel">Delete</button><span class="grow"></span>' +
      '<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="eSave">Save</button></div>',
      function (dlg) {
        $('#eSave', dlg).onclick = function () {
          var ch = { op: 'update', id: it.id }, any = false;
          var n = $('#eName', dlg).value.trim(), q = $('#eQty', dlg).value.trim(),
            no = $('#eNotes', dlg).value.trim(), c = $('#eCat', dlg).value;
          if (n && n !== it.item) { ch.item = n; any = true; }
          if (q !== (it.qty || '')) { ch.qty = q; any = true; }
          if (no !== (it.notes || '')) { ch.notes = no; any = true; }
          if (c !== it.category) { ch.category = c; any = true; }
          var picked = Array.prototype.map.call(dlg.querySelectorAll('.store-tags input:checked'), function (x) { return x.value; });
          if (S.stores.length > 1 && picked.join('|') !== (it.stores || []).join('|')) { ch.stores = picked; any = true; }
          closeDialog();
          if (any) queue(ch);
        };
        $('#eDel', dlg).onclick = function () {
          var copy = JSON.parse(JSON.stringify(it));
          closeDialog();
          queue({ op: 'delete', id: it.id });
          toast('Deleted ' + copy.item.toLowerCase(), 'Undo', function () {
            queue({ op: 'add', id: glId(), item: copy.item, qty: copy.qty, notes: copy.notes, stores: copy.stores || [] });
          });
        };
      });
  }

  function showMenu() {
    var pending = S.outbox.length;
    openDialog(
      '<h2>Grocery list</h2>' +
      '<p>This phone: <b>' + esc(me()) + '</b>' + (cfg.device ? ' · ' + esc(cfg.device) : '') + '</p>' +
      '<p class="meta">App version ' + APP_VERSION + ' · Last synced: ' + (S.lastSync ? esc(when(S.lastSync)) : 'never') +
      (pending ? '<br>' + pending + ' change' + (pending > 1 ? 's' : '') + ' waiting to upload' : '') + '</p>' +
      '<p class="meta"><b>Tips:</b> Type or say several items at once: “2 gallons of milk, eggs and bread”. ' +
      'Add “from Costco” to tag a store. Tap an item to edit it. Long-press the app icon for “Add by voice”.</p>' +
      '<div class="menu-btns"><button class="btn wide" id="mNotify">🔔 Notifications</button>' +
      '<button class="btn wide" id="mStores">🏬 Stores &amp; aisle order</button>' +
      '<button class="btn wide" id="mDisplay">🎨 Colors &amp; text size</button></div>' +
      '<div class="dlg-actions"><button class="btn danger" id="mReset">Disconnect phone</button><span class="grow"></span>' +
      '<button class="btn ghost" id="mSync">Sync now</button><button class="btn primary" data-close>Close</button></div>',
      function (dlg) {
        $('#mSync', dlg).onclick = function () { closeDialog(); sync(); };
        $('#mDisplay', dlg).onclick = showSettings;
        $('#mNotify', dlg).onclick = showNotifySettings;
        $('#mStores', dlg).onclick = showStores;
        $('#mReset', dlg).onclick = function () {
          if (S.outbox.length && !confirm(S.outbox.length + ' changes have not uploaded yet and will be lost. Disconnect anyway?')) return;
          closeDialog(); cfg = null; localStorage.removeItem(K.cfg); resetLocal(); render();
        };
      });
  }

  // ---------------------------------------------------------------- voice
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var rec = null;
  function startVoice() {
    var input = $('#addInput');
    if (!SR) {
      toast('Voice isn’t available in this browser — tap the 🎤 on your keyboard instead.');
      if (input) input.focus();
      hideVoiceOverlay();
      return;
    }
    if (rec) { rec.stop(); return; }
    var finalText = '';
    rec = new SR();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = function (e) {
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
        else interim += e.results[i][0].transcript;
      }
      var shown = (finalText + interim).trim();
      if (input) input.value = shown;
      var vt = $('#voiceText'); if (vt) vt.textContent = shown || 'Listening…';
    };
    rec.onerror = function (e) {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Microphone permission is blocked for this app.');
      else if (e.error === 'network') toast('Voice needs internet — use the 🎤 on your keyboard while offline.');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') toast('Voice error: ' + e.error);
    };
    rec.onend = function () {
      rec = null;
      var mic = $('#micBtn'); if (mic) mic.classList.remove('listening');
      hideVoiceOverlay();
      var t = finalText.trim();
      if (t) { if (input) input.value = ''; addFromText(t); }
    };
    var mic = $('#micBtn'); if (mic) mic.classList.add('listening');
    try { rec.start(); } catch (e) { rec = null; if (mic) mic.classList.remove('listening'); }
  }
  function showVoiceOverlay() {
    var o = document.createElement('div');
    o.id = 'voiceOverlay';
    o.innerHTML = '<button id="voiceGo" class="voice-big" aria-label="Tap to speak">🎤</button>' +
      '<p id="voiceText">Tap the microphone and say what to add</p><button class="btn ghost" id="voiceCancel">Cancel</button>';
    document.body.appendChild(o);
    $('#voiceGo').onclick = function () { $('#voiceText').textContent = 'Listening…'; $('#voiceGo').classList.add('listening'); startVoice(); };
    $('#voiceCancel').onclick = function () { if (rec) rec.abort(); hideVoiceOverlay(); };
  }
  function hideVoiceOverlay() { var o = $('#voiceOverlay'); if (o) o.remove(); }

  // keep the screen on while shopping
  var wakeLock = null;
  function keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator && !wakeLock) {
        navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; l.addEventListener('release', function () { wakeLock = null; }); }).catch(function () {});
      } else if (!on && wakeLock) { wakeLock.release(); wakeLock = null; }
    } catch (e) {}
  }

  // ---------------------------------------------------------------- dialogs & toast
  function openDialog(html, wire) {
    var d = $('#dialog');
    d.innerHTML = '<div class="dlg">' + html + '</div>';
    d.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = closeDialog; });
    if (wire) wire(d);
    if (d.open) return;
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  }
  function closeDialog() { var d = $('#dialog'); if (d.close) d.close(); else d.removeAttribute('open'); }

  var toastTimer = null;
  function toast(msg, actionLabel, onAction) {
    var t = $('#toast');
    t.innerHTML = '<span>' + esc(msg) + '</span>' + (actionLabel ? '<button>' + esc(actionLabel) + '</button>' : '');
    t.className = 'show';
    if (actionLabel) t.querySelector('button').onclick = function () { t.className = ''; onAction(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, actionLabel ? 6000 : 3500);
  }

  function when(isoStr) {
    if (!isoStr) return '';
    var d = new Date(isoStr); if (isNaN(d)) return '';
    var now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
    var time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return 'Today ' + time;
    if (d.toDateString() === y.toDateString()) return 'Yesterday ' + time;
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }

  // ---------------------------------------------------------------- stores manager
  function showStores() {
    openDialog('<h2>Stores &amp; aisle order</h2>' +
      '<p class="meta">Tag items with a store (or say “peanuts from Menards”). Items with no store show up at every store. ' +
      'Each store keeps its own aisle order, and learns it from the order you check things off.</p>' +
      '<ul class="store-list">' + S.stores.map(function (st) {
        return '<li><div><b>' + esc(st.name) + '</b><small>' + (st.learn === false ? 'Learning off' : (st.trips ? 'Learned from ' + st.trips + ' trip' + (st.trips === 1 ? '' : 's') : 'Learns as you shop')) + '</small></div>' +
          '<button class="btn small" data-aisles="' + esc(st.name) + '">Aisles</button>' +
          '<button class="btn small ghost" data-rename="' + esc(st.name) + '">Rename</button>' +
          (S.stores.length > 1 ? '<button class="btn small danger" data-del="' + esc(st.name) + '">✕</button>' : '') + '</li>';
      }).join('') + '</ul>' +
      '<form id="newStore" class="row-form"><input id="newStoreName" placeholder="Add a store, e.g. Costco" maxlength="40" autocomplete="off"><button class="btn primary">Add</button></form>' +
      '<div class="dlg-actions"><span class="grow"></span><button class="btn primary" data-close>Done</button></div>',
      function (dlg) {
        $('#newStore', dlg).onsubmit = function (e) {
          e.preventDefault(); var v = $('#newStoreName', dlg).value.trim(); if (!v) return;
          if (findStore(v)) { toast(v + ' is already a store.'); return; }
          queue({ op: 'addStore', name: v }); showStores();
        };
        dlg.querySelectorAll('[data-aisles]').forEach(function (b) { b.onclick = function () { showAisles(b.getAttribute('data-aisles')); }; });
        dlg.querySelectorAll('[data-rename]').forEach(function (b) {
          b.onclick = function () {
            var from = b.getAttribute('data-rename');
            openDialog('<h2>Rename store</h2><label>New name<input id="rnName" value="' + esc(from) + '" maxlength="40"></label>' +
              '<div class="dlg-actions"><span class="grow"></span><button class="btn ghost" id="rnBack">Back</button><button class="btn primary" id="rnSave">Save</button></div>',
              function (d2) {
                $('#rnBack', d2).onclick = showStores;
                $('#rnSave', d2).onclick = function () {
                  var to = $('#rnName', d2).value.trim();
                  if (to && to !== from) { if (findStore(to) && findStore(to).name !== from) { toast(to + ' is already a store.'); return; } queue({ op: 'renameStore', from: from, to: to }); }
                  showStores();
                };
              });
          };
        });
        dlg.querySelectorAll('[data-del]').forEach(function (b) {
          b.onclick = function () {
            var name = b.getAttribute('data-del');
            openDialog('<h2>Delete ' + esc(name) + '?</h2><p>Items tagged only for ' + esc(name) + ' will show at every store instead. Nothing is removed from your list.</p>' +
              '<div class="dlg-actions"><span class="grow"></span><button class="btn ghost" id="dlBack">Back</button><button class="btn danger" id="dlYes">Delete store</button></div>',
              function (d2) {
                $('#dlBack', d2).onclick = showStores;
                $('#dlYes', d2).onclick = function () { queue({ op: 'deleteStore', name: name }); showStores(); };
              });
          };
        });
      });
  }

  function showAisles(name) {
    var st = findStore(name); if (!st) return showStores();
    var order = catOrder(name);
    function draw() {
      return '<h2>' + esc(st.name) + ' aisle order</h2><p class="meta">Put sections in the order you walk through this store.</p>' +
        '<ol class="aisles">' + order.map(function (c, i) {
          return '<li><span>' + esc(c) + '</span><button class="btn small ghost" data-up="' + i + '"' + (i ? '' : ' disabled') + ' aria-label="Move up">▲</button>' +
            '<button class="btn small ghost" data-down="' + i + '"' + (i < order.length - 1 ? '' : ' disabled') + ' aria-label="Move down">▼</button></li>';
        }).join('') + '</ol>' +
        '<label class="switch-row"><span>Learn from the order I check things off</span><input type="checkbox" role="switch" id="learnSw"' + (st.learn === false ? '' : ' checked') + '></label>' +
        '<div class="dlg-actions"><button class="btn ghost" id="aiReset">Reset</button><span class="grow"></span>' +
        '<button class="btn ghost" id="aiBack">Back</button><button class="btn primary" id="aiSave">Save</button></div>';
    }
    function wire(dlg) {
      dlg.querySelectorAll('[data-up]').forEach(function (b) { b.onclick = function () { var i = +b.dataset.up; order.splice(i - 1, 0, order.splice(i, 1)[0]); openDialog(draw(), wire); }; });
      dlg.querySelectorAll('[data-down]').forEach(function (b) { b.onclick = function () { var i = +b.dataset.down; order.splice(i + 1, 0, order.splice(i, 1)[0]); openDialog(draw(), wire); }; });
      $('#aiReset', dlg).onclick = function () { order = GL_CATEGORIES.slice(); openDialog(draw(), wire); };
      $('#aiBack', dlg).onclick = showStores;
      $('#aiSave', dlg).onclick = function () {
        queue({ op: 'setStoreOrder', name: st.name, order: order });
        var learn = $('#learnSw', dlg).checked;
        if (learn !== (st.learn !== false)) queue({ op: 'setStoreLearn', name: st.name, learn: learn });
        toast(st.name + ' aisle order saved.'); showStores();
      };
    }
    openDialog(draw(), wire);
  }

  // ---------------------------------------------------------------- notifications
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function shouldAskPush() {
    return cfg && pushSupported() && Notification.permission === 'default' && !load('gl.pushAsked', 0) && S.lastSync && S.vapidKey;
  }
  function b64ToBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    var raw = atob(s), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function subscribePush() {
    return navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription().then(function (sub) {
        var key = b64ToBytes(S.vapidKey);
        if (sub && sub.options && sub.options.applicationServerKey) {
          var cur = new Uint8Array(sub.options.applicationServerKey);
          if (cur.length !== key.length || cur.some(function (b, i) { return b !== key[i]; })) return sub.unsubscribe().then(function () { return null; });
        }
        return sub;
      }).then(function (sub) {
        return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      });
    }).then(function (sub) {
      idbSet('cfg', { api: cfg.api, token: cfg.token });
      queue({ op: 'subscribe', sub: { endpoint: sub.endpoint } });
      return true;
    });
  }
  function enablePush() {
    save('gl.pushAsked', Date.now());
    if (!pushSupported()) {
      toast(isIOS && !standalone ? 'On iPhone, add the app to your Home Screen first, then turn on notifications from there.' : 'This browser can’t show notifications.');
      return Promise.resolve(false);
    }
    if (!S.vapidKey) { toast('Connect to the list first, then try again.'); return Promise.resolve(false); }
    return Notification.requestPermission().then(function (p) {
      if (p !== 'granted') { toast('Notifications are blocked. Allow them in your phone’s settings for this app.'); renderBanner(); return false; }
      return subscribePush().then(function () { toast('🔔 Notifications are on.'); renderBanner(); return true; });
    }).catch(function () { toast('Couldn’t turn on notifications. Try again when you have signal.'); return false; });
  }
  function disablePush() {
    queue({ op: 'unsubscribe' });
    if (pushSupported()) navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription().then(function (s) { if (s) return s.unsubscribe(); });
    }).catch(function () {});
  }
  var resubTried = false;
  function autoResubscribe() {   // e.g. after reinstalling: permission is still granted but the server lost the subscription
    if (resubTried || !cfg || cfg.push || !pushSupported() || Notification.permission !== 'granted' || !S.vapidKey) return;
    if (S.outbox.some(function (o) { return o.op === 'unsubscribe' || o.op === 'subscribe'; })) return;
    if (load('gl.pushOff', false)) return;
    resubTried = true;
    subscribePush().catch(function () {});
  }

  function showNotifySettings() {
    var p = cfg.prefs || {};
    var on = function (k) { return p[k] !== false; };
    var perm = pushSupported() ? Notification.permission : 'unsupported';
    var status, button;
    if (perm === 'unsupported') {
      status = isIOS && !standalone ? 'On iPhone, notifications work after you add this app to your Home Screen (Share → Add to Home Screen) and open it from there.' : 'This browser can’t show notifications.';
      button = '';
    } else if (perm === 'denied') {
      status = '⛔ Notifications are blocked for this app. Allow them in your phone’s settings (Settings → Apps / Notifications), then come back here.';
      button = '';
    } else if (cfg.push && perm === 'granted') {
      status = '✅ On for this phone.';
      button = '<button class="btn ghost" id="nOff">Turn off on this phone</button>';
    } else {
      status = 'Off for this phone.';
      button = '<button class="btn primary" id="nOn">Turn on notifications</button>';
    }
    var sw = function (k, label) {
      return '<label class="switch-row"><span>' + label + '</span><input type="checkbox" role="switch" data-pref="' + k + '"' + (on(k) ? ' checked' : '') + '></label>';
    };
    openDialog('<h2>🔔 Notifications</h2><p>' + status + '</p>' + button +
      '<div class="dlg-label">Notify me when someone…</div>' +
      sw('n_add', 'adds items') + sw('n_trip', 'starts shopping (“I’m at the store”)') + sw('n_bought', 'checks items off') +
      '<div class="dlg-label">When I tap Shop Now…</div>' +
      sw('announce_trip', 'let everyone know I’m at the store') +
      '<div class="dlg-actions"><span class="grow"></span><button class="btn primary" data-close>Done</button></div>',
      function (dlg) {
        var bOn = $('#nOn', dlg), bOff = $('#nOff', dlg);
        if (bOn) bOn.onclick = function () { save('gl.pushOff', false); enablePush().then(function () { setTimeout(showNotifySettings, 400); }); };
        if (bOff) bOff.onclick = function () { save('gl.pushOff', true); disablePush(); toast('Notifications are off for this phone.'); showNotifySettings(); };
        dlg.querySelectorAll('[data-pref]').forEach(function (inp) {
          inp.onchange = function () { var o = { op: 'setPrefs' }; o[inp.dataset.pref] = inp.checked; queue(o); };
        });
      });
  }

  // tiny IndexedDB key/value store, shared with the service worker
  function idb() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('no idb'));
      var r = indexedDB.open('grocery', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
  }
  function idbSet(k, v) {
    return idb().then(function (db) {
      return new Promise(function (res) { var tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = res; });
    }).catch(function () {});
  }
  function markSeen() {   // notifications summarize what happened since you last looked at the app
    if (document.visibilityState !== 'visible') return;
    idbSet('seenAt', new Date().toISOString());
    if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (reg && reg.getNotifications) reg.getNotifications({ tag: 'grocery' }).then(function (ns) { ns.forEach(function (n) { n.close(); }); });
      }).catch(function () {});
    }
  }

  // ---------------------------------------------------------------- rendering
  function catOrder(storeName) {
    var st = findStore(storeName), rank = (st && st.catRank) || {};
    var r = function (c) { var i = GL_CATEGORIES.indexOf(c); return rank[c] != null ? rank[c] : (i < 0 ? 99 : i); };
    return GL_CATEGORIES.slice().sort(function (a, b) { return r(a) - r(b); });
  }
  function groups(items, storeName) {
    var by = {};
    items.forEach(function (i) { var c = i.category || 'Other'; (by[c] = by[c] || []).push(i); });
    var order = catOrder(storeName).concat(Object.keys(by).filter(function (c) { return GL_CATEGORIES.indexOf(c) < 0; }));
    var st = findStore(storeName), ir = (st && st.itemRank) || {};
    var rk = function (i) { var v = ir[glKey(i.item)]; return v == null ? 1e9 : v; };
    return order.filter(function (c) { return by[c]; }).map(function (c) {
      return { cat: c, items: by[c].sort(function (a, b) { return rk(a) - rk(b) || a.item.localeCompare(b.item); }) };
    });
  }

  function render() {
    if (!cfg || S.error === 'unauthorized') return renderSetup();
    ensureShell();
    document.body.classList.toggle('shopping', S.view === 'shop');
    renderStatus(); renderBanner(); renderStoreChips(); renderChips(); renderList(); renderFooter();
    var inp = $('#addInput');
    if (inp) inp.placeholder = S.view === 'list' && S.filter ? 'Add to ' + S.filter + '…' : 'Add items… e.g. milk, 2 eggs and bread';
  }

  function renderSetup() {
    document.body.classList.remove('shopping');
    var bad = S.error === 'unauthorized';
    $('#app').innerHTML =
      '<div class="setup"><div class="logo">🛒</div><h1>Grocery List</h1>' +
      (bad ? '<p class="err">This phone’s access was turned off or the link is wrong. Ask for a new setup link.</p>' : '') +
      '<p>Paste the setup link you were sent (or open the link on this phone).</p>' +
      '<textarea id="setupLink" rows="4" placeholder="https://…#api=…&token=…"></textarea>' +
      '<button class="btn primary wide" id="setupGo">Connect</button>' +
      '<p class="err" id="setupErr"></p></div>';
    $('#setupGo').onclick = function () {
      var c = parseSetup($('#setupLink').value);
      if (!c) { $('#setupErr').textContent = 'That doesn’t look like a setup link.'; return; }
      resetLocal(); cfg = c; save(K.cfg, cfg); S.error = null;
      $('#setupGo').textContent = 'Connecting…';
      sync().then(function () {
        if (S.error === 'unauthorized') { render(); }
        else if (S.error) { $('#setupErr').textContent = 'Saved, but couldn’t reach the list yet. It will retry automatically.'; setTimeout(render, 1500); }
        else render();
      });
    };
  }

  var shellBuilt = false;
  function ensureShell() {
    if (shellBuilt && $('#shell')) return;
    shellBuilt = true;
    $('#app').innerHTML =
      '<div id="shell">' +
      '<div class="stickyhead"><header class="top"><div class="title"><h1 id="title">Groceries</h1><button id="syncPill" class="pill"></button></div>' +
      '<button id="menuBtn" class="icon-btn" aria-label="Menu">⋯</button></header>' +
      '<div id="progress"><div></div></div>' +
      '<form id="addForm" class="addbar" autocomplete="off">' +
      '<input id="addInput" enterkeyhint="done" placeholder="Add items… e.g. milk, 2 eggs and bread">' +
      '<button type="button" id="micBtn" class="icon-btn mic" aria-label="Add by voice">🎤</button>' +
      '<button type="submit" class="btn primary">Add</button></form></div>' +
      '<div id="banner"></div>' +
      '<div id="storeChips"></div><div id="chips"></div><main id="list"></main><footer id="footer"></footer></div>';

    $('#addForm').onsubmit = function (e) {
      e.preventDefault();
      var v = $('#addInput').value.trim(); if (!v) return;
      $('#addInput').value = '';
      addFromText(v);
    };
    $('#micBtn').onclick = startVoice;
    $('#menuBtn').onclick = showMenu;
    $('#syncPill').onclick = function () { sync(); };
    $('#list').onclick = function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var id = b.closest('[data-id]').getAttribute('data-id');
      if (b.dataset.act === 'edit') editItem(id);
      if (b.dataset.act === 'toggle') {
        var it = findItem(id); if (!it) return;
        if (navigator.vibrate) navigator.vibrate(15);
        queue({ op: 'check', id: it.id, bought: it.status !== 'bought' });
      }
    };
    $('#storeChips').onclick = function (e) {
      var b = e.target.closest('[data-filter]'); if (!b) return;
      S.filter = b.getAttribute('data-filter'); persist(); render();
    };
    $('#chips').onclick = function (e) {
      var b = e.target.closest('[data-name]'); if (b) addFromText(b.getAttribute('data-name'));
    };
  }

  function renderStatus() {
    var p = $('#syncPill'); if (!p) return;
    var n = S.outbox.length, txt, cls;
    if (S.syncing) { txt = 'Syncing…'; cls = 'busy'; }
    else if (S.error === 'offline') { txt = 'Offline' + (n ? ' · ' + n + ' to send' : ''); cls = 'warn'; }
    else if (S.error) { txt = 'Can’t reach list' + (n ? ' · ' + n + ' to send' : ''); cls = 'warn'; }
    else if (n) { txt = n + ' to send'; cls = 'busy'; }
    else { txt = S.lastSync ? 'Synced' : 'Not synced yet'; cls = 'ok'; }
    p.textContent = txt; p.className = 'pill ' + cls;
  }

  function renderBanner() {
    var b = $('#banner');
    if (S.view === 'list' && S.trip) {
      var mine = S.trip.started_by === me();
      var at = S.trip.store ? ' at ' + esc(S.trip.store) : '';
      b.innerHTML = '<div class="banner"><span>🛒 ' + (mine ? 'Your shopping trip' + at + ' is still open' : esc(S.trip.started_by) + ' is shopping' + at + ' now') +
        '</span><button class="btn small" id="joinTrip">' + (mine ? 'Resume' : 'Join') + '</button></div>';
      $('#joinTrip').onclick = function () { enterShop(); };
    } else if (S.view === 'list' && shouldAskPush()) {
      b.innerHTML = '<div class="banner"><span>🔔 Get an alert when family adds items or goes shopping</span>' +
        '<button class="btn small ghost" id="pushLater">Not now</button><button class="btn small primary" id="pushOn">Turn on</button></div>';
      $('#pushOn').onclick = function () { enablePush(); };
      $('#pushLater').onclick = function () { save('gl.pushAsked', Date.now()); renderBanner(); };
    } else b.innerHTML = '';
  }

  function renderStoreChips() {
    var c = $('#storeChips');
    if (S.view !== 'list' || S.stores.length < 2) { c.innerHTML = ''; return; }
    var open = S.items.filter(function (i) { return i.status === 'open'; });
    var chip = function (val, label, n) {
      return '<button class="schip' + (S.filter === val ? ' on' : '') + '" data-filter="' + esc(val) + '">' + esc(label) + ' <span>' + n + '</span></button>';
    };
    c.innerHTML = chip('', 'All stores', open.length) + S.stores.map(function (st) {
      return chip(st.name, st.name, open.filter(function (i) { return inStore(i, st.name); }).length);
    }).join('');
  }

  function renderChips() {
    var c = $('#chips');
    if (S.view !== 'list' || !S.recent.length) { c.innerHTML = ''; return; }
    var openKeys = {};
    S.items.forEach(function (i) { if (i.status === 'open') openKeys[glKey(i.item)] = 1; });
    var list = S.recent.filter(function (n) { return !openKeys[glKey(n)]; }).slice(0, 14);
    c.innerHTML = list.length ? '<span class="chips-label">Quick add</span>' + list.map(function (n) {
      return '<button class="chip" data-name="' + esc(n) + '">+ ' + esc(n) + '</button>';
    }).join('') : '';
  }

  function renderList() {
    var el = $('#list');
    var open = S.items.filter(function (i) { return i.status === 'open'; });
    var bought = S.items.filter(function (i) { return i.status === 'bought'; });
    var title = $('#title'), bar = $('#progress');

    if (S.view === 'shop') {
      var here = S.trip ? S.trip.store : '';
      open = open.filter(function (i) { return inStore(i, here); });
      var total = open.length + bought.length;
      title.textContent = (here && S.stores.length > 1 ? here : 'Shopping') + ' · ' + bought.length + ' of ' + total;
      bar.style.display = 'block';
      bar.firstChild.style.width = (total ? Math.round(100 * bought.length / total) : 0) + '%';
      var html = groups(open, here).map(function (g) {
        return '<section class="group"><h2>' + esc(g.cat) + '</h2><ul>' + g.items.map(checkRow).join('') + '</ul></section>';
      }).join('');
      if (!open.length) html += '<div class="empty">🎉 Everything is in the cart.</div>';
      if (bought.length) {
        html += '<section class="group done"><h2>In the cart (' + bought.length + ')</h2><ul>' +
          bought.sort(function (a, b) { return String(b.bought_at).localeCompare(String(a.bought_at)); }).map(checkRow).join('') +
          '</ul></section>';
      }
      el.innerHTML = html;
      return;
    }

    title.textContent = 'Groceries';
    bar.style.display = 'none';
    if (S.filter) open = open.filter(function (i) { return inStore(i, S.filter); });
    if (!open.length) {
      el.innerHTML = '<div class="empty">' + (S.filter ? 'Nothing to get at ' + esc(S.filter) + '.' : 'The list is empty.') +
        '<br><small>Add something above or tap 🎤 to say it.</small></div>';
      return;
    }
    el.innerHTML = groups(open, S.filter).map(function (g) {
      return '<section class="group"><h2>' + esc(g.cat) + ' <span class="count">' + g.items.length + '</span></h2><ul>' +
        g.items.map(function (i) {
          return '<li data-id="' + esc(i.id) + '"><button class="row" data-act="edit">' +
            '<span class="name">' + esc(i.item) + (i.qty ? ' <span class="qty">' + esc(i.qty) + '</span>' : '') +
            (i.pending ? ' <span class="dot" title="Not uploaded yet"></span>' : '') + '</span>' +
            (i.notes ? '<span class="notes">' + esc(i.notes) + '</span>' : '') +
            ((i.stores || []).length && S.stores.length > 1 ? '<span class="stags">' + i.stores.map(function (x) { return '<span>🏬 ' + esc(x) + '</span>'; }).join('') + '</span>' : '') +
            '<span class="meta">' + esc(i.added_by) + (i.added_device ? ' · ' + esc(i.added_device) : '') + ' · ' + esc(when(i.added_at)) + '</span>' +
            '</button></li>';
        }).join('') + '</ul></section>';
    }).join('');
  }

  function checkRow(i) {
    var done = i.status === 'bought';
    return '<li data-id="' + esc(i.id) + '" class="' + (done ? 'checked' : '') + '">' +
      '<button class="check" data-act="toggle" aria-pressed="' + done + '">' +
      '<span class="box">' + (done ? '✓' : '') + '</span>' +
      '<span class="cname">' + esc(i.item) + (i.notes ? '<small>' + esc(i.notes) + '</small>' : '') + '</span>' +
      (i.qty ? '<span class="qty">' + esc(i.qty) + '</span>' : '') + '</button></li>';
  }

  function renderFooter() {
    var f = $('#footer');
    var openCount = S.items.filter(function (i) { return i.status === 'open'; }).length;
    if (S.view === 'shop') {
      f.innerHTML = '<button class="btn ghost" id="backBtn">‹ List</button><button class="btn primary big" id="finishBtn">Finish trip</button>';
      $('#backBtn').onclick = leaveShop;
      $('#finishBtn').onclick = finishTrip;
    } else {
      f.innerHTML = '<button class="btn primary big wide" id="shopBtn"' + (openCount || S.trip ? '' : ' disabled') + '>🛒 ' +
        (S.trip ? 'Resume shopping' : 'Shop Now') + (openCount ? ' (' + openCount + ')' : '') + '</button>';
      $('#shopBtn').onclick = function () { enterShop(); };
    }
  }

  // ---------------------------------------------------------------- start up
  render();
  if (cfg) sync();

  var params = new URLSearchParams(location.search);
  if (cfg && params.get('voice')) showVoiceOverlay();
  if (cfg && params.get('shop')) setTimeout(function () { enterShop(); }, 300);
  var shared = [params.get('share_title'), params.get('share_text')].filter(Boolean).join('\n');
  if (cfg && shared) setTimeout(function () { addFromText(shared); }, 300);   // shared from another app
  if (params.toString()) history.replaceState(null, '', location.pathname);
  if (cfg) { idbSet('cfg', { api: cfg.api, token: cfg.token }); markSeen(); }
  if (S.view === 'shop') keepAwake(true);

  setInterval(function () { if (cfg && document.visibilityState === 'visible') sync(); }, 20000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && cfg) { sync(); markSeen(); if (S.view === 'shop') keepAwake(true); }
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'sync') { sync(); markSeen(); }
  });
  window.addEventListener('online', function () { sync(); });
  window.addEventListener('offline', function () { S.error = 'offline'; renderStatus(); });

  // ---------------------------------------------------------------- app updates
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    var hadController = !!navigator.serviceWorker.controller, reloading = false;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') reg.update().catch(function () {});
      });
    }).catch(function () {});
    // A new version took over: reload now if nothing is in progress, otherwise offer it.
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) { hadController = true; return; }   // first install, not an update
      if (reloading) return;
      var busy = ($('#dialog') && $('#dialog').open) || ($('#addInput') && $('#addInput').value) || rec;
      if (!busy) { reloading = true; location.reload(); }
      else toast('A new version of the app is ready.', 'Reload', function () { location.reload(); });
    });
  }

  // exposed for testing / debugging in the browser console
  window.__grocery = { state: S, sync: sync, cfg: function () { return cfg; } };
})();
