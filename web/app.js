(function () {
  'use strict';

  var FL = window.FoldLab;
  var BEZEL = 14;
  var TYPE_ORDER = ['book', 'flip', 'dual-screen', 'rollable'];
  var TYPE_LABEL = { book: 'Book folds', flip: 'Flips', 'dual-screen': 'Dual screen', rollable: 'Rollables' };
  var FOLD_LABELS = {
    book: ['Unfold', 'Fold'],
    flip: ['Unfold', 'Fold'],
    'dual-screen': ['Span both screens', 'Single screen'],
    rollable: ['Extend', 'Retract']
  };

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    form: $('urlForm'), url: $('url'), rail: $('rail'), modes: $('modes'),
    foldBtn: $('foldBtn'), rotateBtn: $('rotateBtn'), linkBtn: $('linkBtn'),
    single: $('single'), wrap: $('deviceWrap'), device: $('device'), screen: $('screen'),
    frame: $('frame'), hinge: $('hinge'), crease: $('crease'), grid: $('grid'),
    toolbar: $('toolbar'), readout: $('readout'), optHinge: $('optHinge'), optAnimate: $('optAnimate'),
    viewSingle: $('viewSingle'), viewGrid: $('viewGrid')
  };

  var devices = [];
  var gridFrames = [];
  var gridDirty = true;
  var shown = null;
  var animToken = 0;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var state = { deviceId: null, modeId: null, rotated: false, url: '', view: 'single', hinge: true, animate: true };

  /* ---------- helpers ---------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function device() {
    return devices.find(function (d) { return d.id === state.deviceId; }) || devices[0];
  }

  function targetMode(modeId, rotated) {
    var dev = device();
    var base = dev.modes.find(function (m) { return m.id === modeId; }) || FL.foldPair(dev).open;
    return rotated ? FL.rotate(base) : base;
  }

  function normalizeUrl(raw) {
    var v = (raw || '').trim();
    if (!v) return 'demo.html';
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v;
    if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/i.test(v)) return 'http://' + v;
    return 'https://' + v;
  }

  function frameSrc(raw) {
    var src = normalizeUrl(raw);
    // Demo page is same-origin; load it directly.
    if (src === 'demo.html' || /^\.\.?\//.test(src)) return src;
    // Localhost targets must stay direct (proxy cannot reach the user's machine).
    try {
      var u = new URL(src, location.href);
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1' || u.hostname === '0.0.0.0') {
        return src;
      }
    } catch (e) { return src; }
    // Route external pages through the local proxy so X-Frame-Options / CSP
    // frame-ancestors cannot blank the device iframe.
    return '/__foldlab_proxy?url=' + encodeURIComponent(src);
  }

  function showFrameStatus(kind, message) {
    var box = document.getElementById('frameStatus');
    if (!box) return;
    if (!kind) {
      box.hidden = true;
      box.textContent = '';
      box.className = 'frame-status';
      return;
    }
    box.hidden = false;
    box.className = 'frame-status ' + kind;
    box.textContent = message;
  }

  function fit(w, h) {
    var aw = els.single.clientWidth - 24;
    var ah = els.single.clientHeight - 24;
    var s = Math.min(1, aw / (w + BEZEL * 2), ah / (h + BEZEL * 2));
    return Math.max(0.08, s);
  }

  function fmt(n) { return String(Math.round(n * 100) / 100); }

  /* ---------- hash state (shareable links) ---------- */

  function readHash() {
    var p = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (p.get('d')) state.deviceId = p.get('d');
    if (p.get('m')) state.modeId = p.get('m');
    state.rotated = p.get('r') === '1';
    if (p.get('u')) state.url = p.get('u');
    if (p.get('v') === 'grid') state.view = 'grid';
    if (p.get('h') === '0') state.hinge = false;
    if (p.get('a') === '0') state.animate = false;
  }

  function writeHash() {
    var p = new URLSearchParams();
    p.set('d', state.deviceId);
    p.set('m', state.modeId);
    if (state.rotated) p.set('r', '1');
    if (state.url) p.set('u', state.url);
    if (state.view === 'grid') p.set('v', 'grid');
    if (!state.hinge) p.set('h', '0');
    if (!state.animate) p.set('a', '0');
    history.replaceState(null, '', '#' + p.toString());
  }

  /* ---------- messaging to the page under test ---------- */

  function post(frame, dev, mode, override) {
    var win = frame && frame.contentWindow;
    if (!win) return;
    var payload = override || FL.toPageState(dev, mode);
    try { win.postMessage({ type: 'foldlab:state', state: payload }, '*'); } catch (e) {}
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.type !== 'foldlab:ready') return;
    if (e.source === els.frame.contentWindow) {
      if (shown) post(els.frame, device(), shown);
      return;
    }
    gridFrames.forEach(function (g) {
      if (g.frame.contentWindow === e.source) post(g.frame, g.dev, g.mode);
    });
  });

  els.frame.addEventListener('load', function () {
    showFrameStatus(null);
    try {
      var doc = els.frame.contentDocument;
      if (doc && doc.title === 'FoldLab proxy error') {
        var msg = doc.body && doc.body.innerText ? doc.body.innerText.replace(/\s+/g, ' ').trim() : 'Could not load page through the proxy.';
        showFrameStatus('error', msg);
      }
    } catch (e) {
      // Cross-origin direct embed (e.g. localhost). Load event still means the browser navigated.
    }
    if (shown) post(els.frame, device(), shown);
  });

  els.frame.addEventListener('error', function () {
    showFrameStatus('error', 'The page failed to load in the device frame.');
  });

  /* ---------- rendering ---------- */

  function renderRail() {
    els.rail.textContent = '';
    TYPE_ORDER.forEach(function (type) {
      var list = devices.filter(function (d) { return d.type === type; });
      if (!list.length) return;
      els.rail.appendChild(el('h2', null, TYPE_LABEL[type]));
      list.forEach(function (d) {
        var b = el('button', 'dev');
        b.type = 'button';
        b.setAttribute('aria-pressed', d.id === state.deviceId ? 'true' : 'false');
        b.appendChild(el('span', null, d.name));
        b.appendChild(el('small', null, d.brand === 'Generic' ? 'concept' : String(d.year)));
        b.addEventListener('click', function () { selectDevice(d.id); });
        els.rail.appendChild(b);
      });
    });
  }

  function renderModes() {
    var dev = device();
    els.modes.textContent = '';
    dev.modes.forEach(function (m) {
      var b = el('button', null, m.label);
      b.type = 'button';
      b.setAttribute('aria-pressed', m.id === state.modeId ? 'true' : 'false');
      b.addEventListener('click', function () { go(m.id, false, true); });
      els.modes.appendChild(b);
    });
    var pair = FL.foldPair(dev);
    var labels = FOLD_LABELS[dev.type] || FOLD_LABELS.book;
    var isClosed = state.modeId === pair.closed.id;
    els.foldBtn.textContent = isClosed ? labels[0] : labels[1];
    els.foldBtn.hidden = pair.closed === pair.open;
    els.rotateBtn.hidden = dev.type === 'rollable';
  }

  function drawHinge(container, mode, show, cls) {
    var h = FL.resolveHinge(mode);
    container.className = cls || 'hinge';
    if (!show || !h) {
      container.hidden = true;
      return;
    }
    var seam = h.length < 2;
    var thick = seam ? 2 : h.length;
    var pos = seam ? h.offset + h.length / 2 - 1 : h.offset;
    container.hidden = false;
    container.classList.add(seam ? 'seam' : 'gap');
    if (h.orientation === 'vertical') {
      container.style.cssText = 'top:0;bottom:0;left:' + pos + 'px;width:' + thick + 'px';
    } else {
      container.style.cssText = 'left:0;right:0;top:' + pos + 'px;height:' + thick + 'px';
    }
  }

  function drawCrease(mode, show) {
    if (!show || FL.resolveHinge(mode) || !mode.crease) {
      els.crease.hidden = true;
      return;
    }
    els.crease.hidden = false;
    var o = mode.rotated ? (mode.crease === 'vertical' ? 'horizontal' : 'vertical') : mode.crease;
    els.crease.className = 'crease ' + (o === 'vertical' ? 'v' : 'h');
  }

  function layout(w, h, scale) {
    els.screen.style.width = w + 'px';
    els.screen.style.height = h + 'px';
    els.device.style.transform = 'scale(' + scale + ')';
    els.wrap.style.width = (w + BEZEL * 2) * scale + 'px';
    els.wrap.style.height = (h + BEZEL * 2) * scale + 'px';
  }

  function loadFrame(force) {
    var target = normalizeUrl(state.url);
    var src = frameSrc(state.url);
    if (!force && els.frame.getAttribute('data-src') === src) return;
    els.frame.setAttribute('data-src', src);
    els.frame.setAttribute('data-target', target);
    showFrameStatus('loading', 'Loading ' + target + '…');
    els.frame.src = src;
  }

  function renderReadout(dev, mode) {
    var s = FL.toPageState(dev, mode);
    var h = FL.resolveHinge(mode);
    els.readout.textContent = '';
    var name = el('div', 'name', dev.name + ' ');
    name.appendChild(el('span', null, mode.label + (mode.rotated ? ', rotated' : '')));
    els.readout.appendChild(name);

    var dl = el('dl');
    function row(k, v, cls) {
      var d = el('div');
      d.appendChild(el('dt', null, k));
      d.appendChild(el('dd', cls || null, v));
      dl.appendChild(d);
    }
    row('Viewport', fmt(mode.width) + ' × ' + fmt(mode.height) + ' css px');
    row('Pixel ratio', fmt(mode.dpr) + '×');
    row('Posture', s.posture);
    row('Segments', s.segments.length + (s.segments.length > 1
      ? ' (' + s.segments.map(function (g) { return fmt(g.width) + '×' + fmt(g.height); }).join(' + ') + ')'
      : ''));
    row('Hinge', h ? h.orientation + ' at ' + fmt(h.offset) + 'px, ' + (h.length ? fmt(h.length) + 'px gap' : 'no gap') : 'none');
    if (dev.approximate) row('Data', 'approximate', 'tag');
    els.readout.appendChild(dl);
    if (dev.approximate && dev.note) els.readout.title = dev.note; else els.readout.removeAttribute('title');
  }

  function render(mode) {
    var dev = device();
    shown = mode;
    var s = fit(mode.width, mode.height);
    layout(mode.width, mode.height, s);
    drawHinge(els.hinge, mode, state.hinge, 'hinge');
    drawCrease(mode, state.hinge);
    renderReadout(dev, mode);
    loadFrame();
    post(els.frame, dev, mode);
  }

  function animateTo(from, to) {
    var token = ++animToken;
    var dev = device();
    var scale = Math.min(fit(from.width, from.height), fit(to.width, to.height));
    var start = null;
    var duration = 620;
    els.hinge.hidden = true;
    els.crease.hidden = true;
    var mid = FL.toPageState(dev, Object.assign({}, to, { hinge: null, posture: 'continuous' }));
    post(els.frame, dev, to, mid);

    function step(ts) {
      if (token !== animToken) return;
      if (start == null) start = ts;
      var t = Math.min(1, (ts - start) / duration);
      var size = FL.lerpSize(from, to, FL.easeInOutCubic(t));
      layout(size.width, size.height, scale);
      if (t < 1) requestAnimationFrame(step);
      else render(to);
    }
    requestAnimationFrame(step);
  }

  /* ---------- actions ---------- */

  function go(modeId, rotated, animate) {
    var from = shown;
    var to = targetMode(modeId, rotated);
    state.modeId = modeId;
    state.rotated = rotated;
    renderModes();
    writeHash();
    if (state.view !== 'single') return;
    var canAnimate = animate && state.animate && !reduced && from && (from.width !== to.width || from.height !== to.height);
    if (canAnimate) animateTo(from, to); else { animToken++; render(to); }
  }

  function selectDevice(id) {
    state.deviceId = id;
    var pair = FL.foldPair(device());
    state.modeId = pair.open.id;
    state.rotated = false;
    renderRail();
    shown = null;
    go(state.modeId, false, false);
  }

  function toggleFold() {
    var pair = FL.foldPair(device());
    var next = state.modeId === pair.closed.id ? pair.open.id : pair.closed.id;
    go(next, false, true);
  }

  function setView(view) {
    state.view = view;
    var grid = view === 'grid';
    els.single.hidden = grid;
    els.grid.hidden = !grid;
    els.toolbar.hidden = grid;
    els.readout.hidden = grid;
    els.viewSingle.setAttribute('aria-pressed', String(!grid));
    els.viewGrid.setAttribute('aria-pressed', String(grid));
    if (grid) {
      if (gridDirty) renderGrid();
    } else {
      render(targetMode(state.modeId, state.rotated));
    }
    writeHash();
  }

  function renderGrid() {
    gridDirty = false;
    els.grid.textContent = '';
    gridFrames = [];
    var src = frameSrc(state.url);
    devices.forEach(function (dev) {
      els.grid.appendChild(el('h2', null, dev.name));
      var row = el('div', 'g-row');
      dev.modes.forEach(function (mode) {
        var card = el('button', 'card');
        card.type = 'button';
        card.setAttribute('aria-label', dev.name + ', ' + mode.label);
        var s = Math.min(190 / mode.width, 300 / mode.height, 1);
        var thumb = el('div', 'thumb');
        thumb.style.width = mode.width * s + 'px';
        thumb.style.height = mode.height * s + 'px';
        var inner = el('div', 'thumb-inner');
        inner.style.width = mode.width + 'px';
        inner.style.height = mode.height + 'px';
        inner.style.transform = 'scale(' + s + ')';
        var f = document.createElement('iframe');
        f.title = dev.name + ' ' + mode.label;
        f.loading = 'lazy';
        f.src = src;
        f.addEventListener('load', function () { post(f, dev, mode); });
        inner.appendChild(f);
        var hinge = el('div');
        drawHinge(hinge, mode, true, 'hinge');
        inner.appendChild(hinge);
        thumb.appendChild(inner);
        card.appendChild(thumb);
        var cap = el('div', 'cap');
        cap.appendChild(el('b', null, mode.label));
        cap.appendChild(document.createElement('br'));
        cap.appendChild(document.createTextNode(fmt(mode.width) + ' × ' + fmt(mode.height)));
        card.appendChild(cap);
        card.addEventListener('click', function () {
          state.deviceId = dev.id;
          state.modeId = mode.id;
          state.rotated = false;
          renderRail();
          renderModes();
          shown = null;
          setView('single');
        });
        row.appendChild(card);
        gridFrames.push({ frame: f, dev: dev, mode: mode });
      });
      els.grid.appendChild(row);
    });
  }

  function copyLink() {
    var url = location.href;
    var done = function () {
      els.linkBtn.textContent = 'Copied';
      setTimeout(function () { els.linkBtn.textContent = 'Copy link'; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, done);
    else done();
  }

  /* ---------- wiring ---------- */

  function bind() {
    els.form.addEventListener('submit', function (e) {
      e.preventDefault();
      state.url = els.url.value.trim();
      gridDirty = true;
      writeHash();
      if (state.view === 'grid') renderGrid(); else loadFrame(true);
    });
    els.foldBtn.addEventListener('click', toggleFold);
    els.rotateBtn.addEventListener('click', function () { go(state.modeId, !state.rotated, true); });
    els.linkBtn.addEventListener('click', copyLink);
    els.viewSingle.addEventListener('click', function () { setView('single'); });
    els.viewGrid.addEventListener('click', function () { setView('grid'); });
    els.optHinge.addEventListener('change', function () {
      state.hinge = els.optHinge.checked;
      writeHash();
      if (shown && state.view === 'single') render(shown);
    });
    els.optAnimate.addEventListener('change', function () {
      state.animate = els.optAnimate.checked;
      writeHash();
    });
    var pending = false;
    window.addEventListener('resize', function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        if (shown && state.view === 'single') {
          layout(shown.width, shown.height, fit(shown.width, shown.height));
        }
      });
    });
  }

  function init(data) {
    devices = data.devices;
    readHash();
    var def = devices.find(function (d) { return d.id === 'samsung-galaxy-z-fold-7'; }) || devices[0];
    if (!devices.some(function (d) { return d.id === state.deviceId; })) state.deviceId = def.id;
    var dev = device();
    if (!dev.modes.some(function (m) { return m.id === state.modeId; })) {
      state.modeId = FL.foldPair(dev).open.id;
      state.rotated = false;
    }
    els.url.value = state.url;
    els.optHinge.checked = state.hinge;
    els.optAnimate.checked = state.animate;
    bind();
    renderRail();
    renderModes();
    setView(state.view);
  }

  fetch('../core/devices.json')
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(init)
    .catch(function (err) {
      var box = el('p', 'error', 'Could not load device profiles (' + err.message + '). Serve the repo root over HTTP (npm start) instead of opening the file directly.');
      document.body.appendChild(box);
    });
})();
