/*!
 * foldlab-client.js — drop-in script that lets your page react to FoldLab.
 *
 *   <script src="https://unpkg.com/foldlab/web/foldlab-client.js"></script>
 *
 * What it does
 *  - Listens for fold state sent by the FoldLab playground (postMessage from the parent frame).
 *  - Falls back to the browser's native Viewport Segments / Device Posture APIs when present
 *    (this is what you get under the FoldLab Chrome extension, which uses real emulation).
 *  - Exposes the state three ways so you can use whichever fits your stack:
 *      1. CSS custom properties on <html>  (--fold-segments, --fold-seg0-w, --fold-hinge-w, ...)
 *      2. data attributes on <html>        (data-fold-segments, data-fold-orientation, data-fold-posture)
 *      3. JS: window.foldlab.state, window.foldlab.onChange(fn)
 *  - Shims matchMedia() for (horizontal|vertical)-viewport-segments, device-posture and
 *    screen-spanning, and (when simulated) navigator.devicePosture and visualViewport.segments.
 *
 * Note: pure CSS @media rules that use those features can only be exercised by real emulation
 * (the Chrome extension). In the web playground, use the CSS variables / data attributes.
 *
 * Development helper only — do not ship it to production.
 */
(function () {
  'use strict';
  if (window.foldlab && window.foldlab.__v) return;

  var FEATURE = /viewport-segments|device-posture|screen-spanning/;
  var origMM = window.matchMedia ? window.matchMedia.bind(window) : function () { return { matches: false }; };
  var state = null;
  var simulated = false;
  var listeners = [];
  var postureListeners = [];
  var mqls = [];

  function fullScreen() {
    return [{ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }];
  }

  function nativeState() {
    var segs = null;
    try {
      var vs = window.visualViewport && window.visualViewport.segments;
      if (vs && vs.length > 1) {
        segs = Array.prototype.map.call(vs, function (r) {
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        });
      }
    } catch (e) {}
    var posture = 'continuous';
    try {
      if (navigator.devicePosture && navigator.devicePosture.type) posture = navigator.devicePosture.type;
    } catch (e) {}
    var orientation = null;
    var hinge = null;
    if (segs) {
      var a = segs[0];
      var b = segs[1];
      if (b.x >= a.x + a.width - 0.5) {
        orientation = 'vertical';
        hinge = { x: a.x + a.width, y: 0, width: b.x - (a.x + a.width), height: window.innerHeight };
      } else {
        orientation = 'horizontal';
        hinge = { x: 0, y: a.y + a.height, width: window.innerWidth, height: b.y - (a.y + a.height) };
      }
    }
    return {
      simulated: false,
      posture: posture,
      orientation: orientation,
      hinge: hinge,
      segments: segs || fullScreen(),
      width: window.innerWidth,
      height: window.innerHeight
    };
  }

  function cssVars(s) {
    var v = {
      '--fold-segments': String(s.segments.length),
      '--fold-posture': s.posture,
      '--fold-orientation': s.orientation || 'none',
      '--fold-hinge-x': (s.hinge ? s.hinge.x : 0) + 'px',
      '--fold-hinge-y': (s.hinge ? s.hinge.y : 0) + 'px',
      '--fold-hinge-w': (s.hinge ? s.hinge.width : 0) + 'px',
      '--fold-hinge-h': (s.hinge ? s.hinge.height : 0) + 'px'
    };
    s.segments.forEach(function (seg, i) {
      v['--fold-seg' + i + '-x'] = seg.x + 'px';
      v['--fold-seg' + i + '-y'] = seg.y + 'px';
      v['--fold-seg' + i + '-w'] = seg.width + 'px';
      v['--fold-seg' + i + '-h'] = seg.height + 'px';
    });
    return v;
  }

  function applyToDom(s) {
    var root = document.documentElement;
    if (!root) return;
    var vars = cssVars(s);
    Object.keys(vars).forEach(function (k) { root.style.setProperty(k, vars[k]); });
    root.setAttribute('data-fold-segments', String(s.segments.length));
    root.setAttribute('data-fold-posture', s.posture);
    root.setAttribute('data-fold-orientation', s.orientation || 'none');
    root.setAttribute('data-fold-simulated', s.simulated ? 'true' : 'false');
  }

  function segCount(axis) {
    if (!state || state.segments.length < 2) return 1;
    var sideBySide = state.orientation === 'vertical';
    return (axis === 'horizontal') === sideBySide ? state.segments.length : 1;
  }

  function evalToken(tok) {
    tok = tok.trim();
    var m = tok.match(/^\(\s*(min-|max-)?(horizontal|vertical)-viewport-segments\s*:\s*(\d+)\s*\)$/);
    if (m) {
      var count = segCount(m[2]);
      var n = Number(m[3]);
      return m[1] === 'min-' ? count >= n : m[1] === 'max-' ? count <= n : count === n;
    }
    m = tok.match(/^\(\s*device-posture\s*:\s*([\w-]+)\s*\)$/);
    if (m) return state.posture === m[1];
    m = tok.match(/^\(\s*screen-spanning\s*:\s*([\w-]+)\s*\)$/);
    if (m) {
      var two = state.segments.length === 2;
      if (m[1] === 'none') return !two;
      if (m[1] === 'single-fold-vertical') return two && state.orientation === 'vertical';
      if (m[1] === 'single-fold-horizontal') return two && state.orientation === 'horizontal';
      return false;
    }
    return origMM(tok).matches;
  }

  function evalQuery(q) {
    return q.split(',').some(function (part) {
      part = part.trim();
      var negate = /^not\s+/i.test(part);
      if (negate) part = part.replace(/^not\s+/i, '');
      var ok = part.split(/\s+and\s+/i).every(evalToken);
      return negate ? !ok : ok;
    });
  }

  function MQL(q) {
    this.media = q;
    this.matches = evalQuery(q);
    this.onchange = null;
    this._l = [];
    mqls.push(this);
  }
  MQL.prototype.addEventListener = function (t, f) { if (t === 'change') this._l.push(f); };
  MQL.prototype.removeEventListener = function (t, f) { this._l = this._l.filter(function (x) { return x !== f; }); };
  MQL.prototype.addListener = MQL.prototype.addEventListener;
  MQL.prototype.removeListener = MQL.prototype.removeEventListener;
  MQL.prototype.dispatchEvent = function () { return true; };
  MQL.prototype._update = function () {
    var next = evalQuery(this.media);
    if (next === this.matches) return;
    this.matches = next;
    var ev = { type: 'change', matches: next, media: this.media };
    this._l.slice().forEach(function (f) { f.call(this, ev); }, this);
    if (typeof this.onchange === 'function') this.onchange(ev);
  };

  window.matchMedia = function (q) {
    return FEATURE.test(String(q)) ? new MQL(String(q)) : origMM(q);
  };

  function toRect(s) {
    return { x: s.x, y: s.y, width: s.width, height: s.height, top: s.y, left: s.x, right: s.x + s.width, bottom: s.y + s.height };
  }

  function installShims() {
    try {
      var dp = {
        get type() { return state.posture; },
        onchange: null,
        addEventListener: function (t, f) { if (t === 'change') postureListeners.push(f); },
        removeEventListener: function (t, f) { postureListeners = postureListeners.filter(function (x) { return x !== f; }); }
      };
      Object.defineProperty(navigator, 'devicePosture', { configurable: true, get: function () { return dp; } });
    } catch (e) {}
    try {
      if (window.visualViewport) {
        Object.defineProperty(window.visualViewport, 'segments', {
          configurable: true,
          get: function () { return state.segments.length > 1 ? state.segments.map(toRect) : null; }
        });
      }
    } catch (e) {}
  }

  function setState(next, isSim) {
    var postureChanged = !state || state.posture !== next.posture;
    if (isSim && !simulated) {
      simulated = true;
      installShims();
    }
    state = next;
    state.simulated = !!isSim;
    applyToDom(state);
    mqls.forEach(function (q) { q._update(); });
    if (postureChanged) postureListeners.slice().forEach(function (f) { f({ type: 'change' }); });
    listeners.slice().forEach(function (f) { f(state); });
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var d = e.data;
    if (d && d.type === 'foldlab:state' && d.state) setState(d.state, true);
  });

  window.addEventListener('resize', function () {
    if (!simulated) setState(nativeState(), false);
  });

  setState(nativeState(), false);

  if (window.parent && window.parent !== window) {
    try { window.parent.postMessage({ type: 'foldlab:ready' }, '*'); } catch (e) {}
  }

  window.foldlab = {
    __v: 1,
    get state() { return state; },
    get isSimulated() { return simulated; },
    onChange: function (fn) {
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (x) { return x !== fn; }); };
    }
  };
})();
