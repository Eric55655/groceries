/* Grocery List — phone app (works offline; syncs to the Google Sheet backend) */
(function () {
  'use strict';

  // ---------------------------------------------------------------- storage
  var K = { cfg: 'gl.cfg', items: 'gl.items', outbox: 'gl.outbox', trip: 'gl.trip', recent: 'gl.recent',
    learned: 'gl.learned', view: 'gl.view', synced: 'gl.synced' };
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  var cfg = load(K.cfg, null);   // { api, token, person, device }
  var S = {
    items: load(K.items, []), outbox: load(K.outbox, []), trip: load(K.trip, null),
    recent: load(K.recent, []), learned: load(K.learned, {}), view: load(K.view, 'list'),
    lastSync: load(K.synced, null), syncing: false, error: null, alias: {}
  };
  function persist() {
    save(K.items, S.items); save(K.outbox, S.outbox); save(K.trip, S.trip); save(K.recent, S.recent);
    save(K.learned, S.learned); save(K.view, S.view); save(K.synced, S.lastSync);
  }

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
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
    }
  })();
  function resetLocal() {
    S.items = []; S.outbox = []; S.trip = null; S.recent = []; S.learned = {}; S.view = 'list'; S.lastSync = null;
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
        S.items.push({ id: op.id, item: glTitle(op.item), qty: op.qty || '', notes: op.notes || '',
          category: glCategorize(op.item, S.learned), status: 'open', added_by: me(),
          added_device: (cfg && cfg.device) || '', added_at: op.at, pending: true });
        return;
      }
      case 'update':
        it = findItem(op.id); if (!it) return;
        if (op.item != null && String(op.item).trim()) it.item = glTitle(op.item);
        if (op.qty != null) it.qty = op.qty;
        if (op.notes != null) it.notes = op.notes;
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
        if (!S.trip) S.trip = { trip_id: op.tripId, started_by: me(), started_device: (cfg && cfg.device) || '', started_at: op.at };
        return;
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
      if (res.who) { cfg.person = res.who.person; cfg.device = res.who.device; save(K.cfg, cfg); }
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
    S.alias = {};
    S.outbox.forEach(applyLocal);   // re-apply changes the server hasn't seen yet
    if (wasShopping && !S.trip) {
      S.view = 'list';
      toast('The shopping trip was finished on another phone.');
    }
  }

  // ---------------------------------------------------------------- actions
  function addFromText(text) {
    var parsed = glParseItems(text);
    if (!parsed.length) return;
    var ids = parsed.map(function (p) {
      var id = glId();
      queue({ op: 'add', id: id, item: p.item, qty: p.qty });
      return id;
    });
    toast('Added ' + parsed.map(function (p) { return p.item.toLowerCase(); }).join(', '), 'Undo', function () {
      ids.forEach(function (id) { if (findItem(id) && !S.alias[id]) queue({ op: 'delete', id: id }); });
    });
  }

  function enterShop() {
    if (!S.items.some(function (i) { return i.status === 'open'; }) && !S.trip) { toast('The list is empty.'); return; }
    if (!S.trip) queue({ op: 'startTrip', tripId: 'T' + glId() });
    S.view = 'shop'; persist(); render(); window.scrollTo(0, 0); keepAwake(true);
  }
  function leaveShop() { S.view = 'list'; persist(); render(); keepAwake(false); }

  function finishTrip() {
    var bought = S.items.filter(function (i) { return i.status === 'bought'; }).length;
    var left = S.items.filter(function (i) { return i.status === 'open'; }).length;
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
          closeDialog();
          if (any) queue(ch);
        };
        $('#eDel', dlg).onclick = function () {
          var copy = JSON.parse(JSON.stringify(it));
          closeDialog();
          queue({ op: 'delete', id: it.id });
          toast('Deleted ' + copy.item.toLowerCase(), 'Undo', function () {
            queue({ op: 'add', id: glId(), item: copy.item, qty: copy.qty, notes: copy.notes });
          });
        };
      });
  }

  function showMenu() {
    var pending = S.outbox.length;
    openDialog(
      '<h2>Grocery list</h2>' +
      '<p>This phone: <b>' + esc(me()) + '</b>' + (cfg.device ? ' · ' + esc(cfg.device) : '') + '</p>' +
      '<p class="meta">Last synced: ' + (S.lastSync ? esc(when(S.lastSync)) : 'never') +
      (pending ? '<br>' + pending + ' change' + (pending > 1 ? 's' : '') + ' waiting to upload' : '') + '</p>' +
      '<p class="meta"><b>Tips:</b> Type or say several items at once: “2 gallons of milk, eggs and bread”. ' +
      'Tap an item to edit it or change its aisle. Long-press the app icon for “Add by voice”.</p>' +
      '<div class="dlg-actions"><button class="btn danger" id="mReset">Disconnect phone</button><span class="grow"></span>' +
      '<button class="btn ghost" id="mSync">Sync now</button><button class="btn primary" data-close>Close</button></div>',
      function (dlg) {
        $('#mSync', dlg).onclick = function () { closeDialog(); sync(); };
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

  // ---------------------------------------------------------------- rendering
  function groups(items) {
    var by = {};
    items.forEach(function (i) { var c = i.category || 'Other'; (by[c] = by[c] || []).push(i); });
    var order = GL_CATEGORIES.concat(Object.keys(by).filter(function (c) { return GL_CATEGORIES.indexOf(c) < 0; }));
    return order.filter(function (c) { return by[c]; }).map(function (c) {
      return { cat: c, items: by[c].sort(function (a, b) { return a.item.localeCompare(b.item); }) };
    });
  }

  function render() {
    if (!cfg || S.error === 'unauthorized') return renderSetup();
    ensureShell();
    document.body.classList.toggle('shopping', S.view === 'shop');
    renderStatus(); renderBanner(); renderChips(); renderList(); renderFooter();
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
      '<header class="top"><div class="title"><h1 id="title">Groceries</h1><button id="syncPill" class="pill"></button></div>' +
      '<button id="menuBtn" class="icon-btn" aria-label="Menu">⋯</button></header>' +
      '<div id="progress"><div></div></div>' +
      '<div id="banner"></div>' +
      '<form id="addForm" class="addbar" autocomplete="off">' +
      '<input id="addInput" enterkeyhint="done" placeholder="Add items… e.g. milk, 2 eggs and bread">' +
      '<button type="button" id="micBtn" class="icon-btn mic" aria-label="Add by voice">🎤</button>' +
      '<button type="submit" class="btn primary">Add</button></form>' +
      '<div id="chips"></div><main id="list"></main><footer id="footer"></footer></div>';

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
      b.innerHTML = '<div class="banner"><span>🛒 ' + (mine ? 'Your shopping trip is still open' : esc(S.trip.started_by) + ' is shopping now') +
        '</span><button class="btn small" id="joinTrip">' + (mine ? 'Resume' : 'Join') + '</button></div>';
      $('#joinTrip').onclick = enterShop;
    } else b.innerHTML = '';
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
      var total = open.length + bought.length;
      title.textContent = 'Shopping · ' + bought.length + ' of ' + total;
      bar.style.display = 'block';
      bar.firstChild.style.width = (total ? Math.round(100 * bought.length / total) : 0) + '%';
      var html = groups(open).map(function (g) {
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
    if (!open.length) {
      el.innerHTML = '<div class="empty">The list is empty.<br><small>Add something above or tap 🎤 to say it.</small></div>';
      return;
    }
    el.innerHTML = groups(open).map(function (g) {
      return '<section class="group"><h2>' + esc(g.cat) + ' <span class="count">' + g.items.length + '</span></h2><ul>' +
        g.items.map(function (i) {
          return '<li data-id="' + esc(i.id) + '"><button class="row" data-act="edit">' +
            '<span class="name">' + esc(i.item) + (i.qty ? ' <span class="qty">' + esc(i.qty) + '</span>' : '') +
            (i.pending ? ' <span class="dot" title="Not uploaded yet"></span>' : '') + '</span>' +
            (i.notes ? '<span class="notes">' + esc(i.notes) + '</span>' : '') +
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
      $('#shopBtn').onclick = enterShop;
    }
  }

  // ---------------------------------------------------------------- start up
  render();
  if (cfg) sync();

  var params = new URLSearchParams(location.search);
  if (cfg && params.get('voice')) showVoiceOverlay();
  if (cfg && params.get('shop')) setTimeout(enterShop, 300);
  if (params.get('voice') || params.get('shop')) history.replaceState(null, '', location.pathname);
  if (S.view === 'shop') keepAwake(true);

  setInterval(function () { if (cfg && document.visibilityState === 'visible') sync(); }, 20000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && cfg) { sync(); if (S.view === 'shop') keepAwake(true); }
  });
  window.addEventListener('online', function () { sync(); });
  window.addEventListener('offline', function () { S.error = 'offline'; renderStatus(); });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  // exposed for testing / debugging in the browser console
  window.__grocery = { state: S, sync: sync, cfg: function () { return cfg; } };
})();
