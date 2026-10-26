(function () {
  'use strict';

  var FL = window.FoldLab;
  var $ = function (id) { return document.getElementById(id); };
  var els = {
    status: $('status'), device: $('device'), modes: $('modes'), fold: $('fold'), rotate: $('rotate'),
    optOverlay: $('optOverlay'), optAnimate: $('optAnimate'), optTouch: $('optTouch'), optUa: $('optUa'),
    readout: $('readout'), msg: $('msg'), grid: $('grid'), stop: $('stop'), move: $('move')
  };

  var FOLD_LABELS = {
    book: ['Unfold', 'Fold'],
    flip: ['Unfold', 'Fold'],
    'dual-screen': ['Span both screens', 'Single screen'],
    rollable: ['Extend', 'Retract']
  };

  var BASE_UA = navigator.userAgent;
  var devices = [];
  var sel = { deviceId: 'samsung-galaxy-z-fold-7', modeId: null, rotated: false };
  var opts = { overlay: true, animate: true, touch: true, ua: true };
  var attachedTabId = null;
  var attachedHost = '';
  var shown = null;
  var token = 0;

  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  function send(method, params) {
    return chrome.debugger.sendCommand({ tabId: attachedTabId }, method, params || {});
  }
  function trySend(method, params) {
    return send(method, params).catch(function () { return null; });
  }

  /* ---------- device helpers ---------- */

  function device() {
    return devices.find(function (d) { return d.id === sel.deviceId; }) || devices[0];
  }

  function targetMode(modeId, rotated) {
    var dev = device();
    var base = dev.modes.find(function (m) { return m.id === modeId; }) || FL.foldPair(dev).open;
    return rotated ? FL.rotate(base) : base;
  }

  function userAgentFor(dev) {
    if (dev.brand === 'Apple') {
      // Approximation of Safari on iPhone; update when Apple documents the Duo's user agent.
      return 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    }
    return BASE_UA.replace(/\(([^)]*)\)/, '(Linux; Android 14; K)').replace(/\sSafari\//, ' Mobile Safari/');
  }

  function fmt(n) { return String(Math.round(n * 100) / 100); }

  /* ---------- UI ---------- */

  function setStatus(text, on) {
    els.status.textContent = text;
    els.status.className = 'pill' + (on ? ' on' : '');
  }

  function setMsg(text, isErr) {
    els.msg.textContent = text || '';
    els.msg.className = 'msg' + (isErr ? ' err' : '');
  }

  function renderDevices() {
    els.device.textContent = '';
    devices.forEach(function (d) {
      var o = document.createElement('option');
      o.value = d.id;
      o.textContent = d.brand === 'Generic' ? d.name : d.name + ' (' + d.year + ')';
      els.device.appendChild(o);
    });
    els.device.value = sel.deviceId;
  }

  function renderModes() {
    var dev = device();
    els.modes.textContent = '';
    dev.modes.forEach(function (m) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = m.label;
      b.setAttribute('aria-pressed', String(m.id === sel.modeId));
      b.addEventListener('click', function () { show(m.id, false, true); });
      els.modes.appendChild(b);
    });
    var pair = FL.foldPair(dev);
    var labels = FOLD_LABELS[dev.type] || FOLD_LABELS.book;
    els.fold.textContent = sel.modeId === pair.closed.id ? labels[0] : labels[1];
    els.fold.hidden = pair.closed === pair.open;
    els.rotate.hidden = dev.type === 'rollable';
  }

  function renderReadout(mode) {
    var dev = device();
    var s = FL.toPageState(dev, mode);
    var h = FL.resolveHinge(mode);
    els.readout.textContent = '';
    function row(k, v, strong) {
      var d = document.createElement('div');
      var a = document.createElement('span');
      a.textContent = k;
      var b = document.createElement(strong ? 'b' : 'span');
      b.textContent = v;
      d.appendChild(a);
      d.appendChild(b);
      els.readout.appendChild(d);
    }
    row(dev.name, mode.label + (mode.rotated ? ', rotated' : ''), true);
    row('Viewport', fmt(mode.width) + ' × ' + fmt(mode.height) + ' @ ' + fmt(mode.dpr) + '×');
    row('Posture', s.posture);
    row('Segments', String(s.segments.length));
    row('Hinge', h ? h.orientation + ', ' + (h.length ? fmt(h.length) + 'px gap' : 'no gap') : 'none');
    if (dev.approximate) row('Data', 'approximate');
  }

  function persist() {
    try { chrome.storage.local.set({ foldlab: { sel: sel, opts: opts } }); } catch (e) { /* storage is optional */ }
  }

  /* ---------- debugger session ---------- */

  function isDebuggable(tab) {
    if (!tab || !tab.url) return false;
    if (!/^(https?|file|ftp):/i.test(tab.url)) return false;
    return !/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i.test(tab.url);
  }

  function hostOf(url) {
    try { return new URL(url).host || url; } catch (e) { return url; }
  }

  async function activeTab() {
    var tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tabs[0];
  }

  async function ensureAttached() {
    if (attachedTabId != null) {
      try {
        await chrome.tabs.get(attachedTabId);
        return;
      } catch (e) {
        attachedTabId = null;
      }
    }
    var tab = await activeTab();
    if (!isDebuggable(tab)) {
      throw new Error('Open a regular web page (http, https or file) in this window first. Chrome does not allow debugging chrome:// pages or the Web Store.');
    }
    try {
      await chrome.debugger.attach({ tabId: tab.id }, '1.3');
    } catch (e) {
      if (!/already attached/i.test(e.message || '')) throw e;
    }
    attachedTabId = tab.id;
    attachedHost = hostOf(tab.url);
  }

  async function apply(mode) {
    var dev = device();
    var cdp = FL.toCdp(mode, { overlay: opts.overlay });
    await send('Emulation.setDeviceMetricsOverride', cdp.metrics);
    await trySend('Emulation.setDevicePostureOverride', { posture: cdp.posture });
    if (opts.touch) {
      await trySend('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await trySend('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
    } else {
      await trySend('Emulation.setTouchEmulationEnabled', { enabled: false });
      await trySend('Emulation.setEmitTouchEventsForMouse', { enabled: false });
    }
    await trySend('Emulation.setUserAgentOverride', {
      userAgent: opts.ua && mode.ua !== 'desktop' ? userAgentFor(dev) : BASE_UA
    });
    if (cdp.hingeOverlay) {
      await trySend('Overlay.enable');
      await trySend('Overlay.setShowHinge', { hingeConfig: cdp.hingeOverlay });
    } else {
      await trySend('Overlay.setShowHinge', {});
    }
  }

  async function tween(from, to, myToken) {
    await trySend('Overlay.setShowHinge', {});
    var frames = 14;
    var duration = 560;
    for (var i = 1; i <= frames; i++) {
      if (myToken !== token) return false;
      var size = FL.lerpSize(from, to, FL.easeInOutCubic(i / frames));
      var w = Math.round(size.width);
      var h = Math.round(size.height);
      await send('Emulation.setDeviceMetricsOverride', {
        width: w, height: h, deviceScaleFactor: to.dpr, mobile: true, screenWidth: w, screenHeight: h
      });
      await sleep(duration / frames);
    }
    return true;
  }

  // Ask the page what it actually sees, so a Chrome build without the foldable web APIs is obvious.
  async function probe(mode) {
    var want = FL.computeSegments(mode).length;
    var r = await trySend('Runtime.evaluate', {
      returnByValue: true,
      expression: "JSON.stringify({s: (window.visualViewport && window.visualViewport.segments) ? window.visualViewport.segments.length : 1," +
        " p: navigator.devicePosture ? navigator.devicePosture.type : null," +
        " mq: matchMedia('(horizontal-viewport-segments: 2)').matches || matchMedia('(vertical-viewport-segments: 2)').matches})"
    });
    if (!r || !r.result || typeof r.result.value !== 'string') return;
    var v = JSON.parse(r.result.value);
    if (want > 1 && v.s < 2 && !v.mq) {
      setMsg('The viewport is emulated, but this Chrome build does not expose viewport segments to pages yet. Turn on chrome://flags/#enable-experimental-web-platform-features and restart Chrome to test @media segment queries.', false);
    } else {
      setMsg('The page sees ' + v.s + (v.s === 1 ? ' segment' : ' segments') + (v.p ? ', posture ' + v.p : ', no navigator.devicePosture') + '.', false);
    }
  }

  async function show(modeId, rotated, animate) {
    sel.modeId = modeId;
    sel.rotated = rotated;
    renderModes();
    persist();
    var to = targetMode(modeId, rotated);
    var my = ++token;
    setMsg('');
    try {
      await ensureAttached();
      if (animate && opts.animate && shown && (shown.width !== to.width || shown.height !== to.height)) {
        var finished = await tween(shown, to, my);
        if (!finished) return;
      }
      if (my !== token) return;
      await apply(to);
      shown = to;
      renderReadout(to);
      setStatus(attachedHost, true);
      await sleep(120);
      await probe(to);
    } catch (e) {
      setMsg(e && e.message ? e.message : String(e), true);
    }
  }

  async function stop() {
    token++;
    if (attachedTabId != null) {
      await trySend('Emulation.clearDeviceMetricsOverride');
      await trySend('Emulation.clearDevicePostureOverride');
      await trySend('Emulation.setTouchEmulationEnabled', { enabled: false });
      await trySend('Emulation.setEmitTouchEventsForMouse', { enabled: false });
      await trySend('Emulation.setUserAgentOverride', { userAgent: BASE_UA });
      await trySend('Overlay.setShowHinge', {});
      try { await chrome.debugger.detach({ tabId: attachedTabId }); } catch (e) { /* already detached */ }
    }
    attachedTabId = null;
    shown = null;
    els.readout.textContent = '';
    els.move.hidden = true;
    setStatus('Not emulating', false);
    setMsg('');
  }

  async function checkActiveTab() {
    if (attachedTabId == null) { els.move.hidden = true; return; }
    var tab = await activeTab();
    els.move.hidden = !tab || tab.id === attachedTabId;
  }

  /* ---------- wiring ---------- */

  function bind() {
    els.device.addEventListener('change', function () {
      sel.deviceId = els.device.value;
      var pair = FL.foldPair(device());
      shown = shown && attachedTabId != null ? shown : null;
      show(pair.open.id, false, true);
    });
    els.fold.addEventListener('click', function () {
      var pair = FL.foldPair(device());
      show(sel.modeId === pair.closed.id ? pair.open.id : pair.closed.id, false, true);
    });
    els.rotate.addEventListener('click', function () { show(sel.modeId, !sel.rotated, true); });

    [['optOverlay', 'overlay'], ['optAnimate', 'animate'], ['optTouch', 'touch'], ['optUa', 'ua']].forEach(function (pair) {
      els[pair[0]].addEventListener('change', function () {
        opts[pair[1]] = els[pair[0]].checked;
        persist();
        if (attachedTabId != null && shown) show(sel.modeId, sel.rotated, false);
      });
    });

    els.grid.addEventListener('click', async function () {
      var tab = await activeTab();
      var url = tab && /^https?:|^file:/i.test(tab.url || '') ? tab.url : '';
      chrome.runtime.sendMessage({ type: 'foldlab:open-playground', url: url, view: 'grid' }, function (res) {
        if (chrome.runtime.lastError || (res && !res.ok)) {
          setMsg('Could not open the all-devices view: ' + ((res && res.error) || chrome.runtime.lastError.message), true);
        }
      });
    });

    els.stop.addEventListener('click', stop);
    els.move.addEventListener('click', async function () {
      await stop();
      show(sel.modeId, sel.rotated, false);
    });

    chrome.tabs.onActivated.addListener(checkActiveTab);
    chrome.debugger.onDetach.addListener(function (source, reason) {
      if (source.tabId !== attachedTabId) return;
      attachedTabId = null;
      shown = null;
      els.move.hidden = true;
      setStatus('Not emulating', false);
      setMsg(reason === 'canceled_by_user' ? 'Emulation stopped because the debugging bar was closed.' : 'Emulation stopped (' + reason + ').', false);
    });
    window.addEventListener('pagehide', function () {
      if (attachedTabId != null) chrome.debugger.detach({ tabId: attachedTabId }).catch(function () {});
    });
  }

  async function init() {
    var res = await fetch('playground/core/devices.json');
    devices = (await res.json()).devices;
    try {
      var saved = (await chrome.storage.local.get('foldlab')).foldlab;
      if (saved) {
        Object.assign(sel, saved.sel);
        Object.assign(opts, saved.opts);
      }
    } catch (e) { /* first run */ }
    if (!devices.some(function (d) { return d.id === sel.deviceId; })) sel.deviceId = devices[0].id;
    var dev = device();
    if (!dev.modes.some(function (m) { return m.id === sel.modeId; })) {
      sel.modeId = FL.foldPair(dev).open.id;
      sel.rotated = false;
    }
    els.optOverlay.checked = opts.overlay;
    els.optAnimate.checked = opts.animate;
    els.optTouch.checked = opts.touch;
    els.optUa.checked = opts.ua;
    renderDevices();
    renderModes();
    bind();
    setMsg('Pick a device state to start emulating the current tab.');
  }

  init().catch(function (e) { setMsg('Could not load device profiles: ' + e.message, true); });
})();
