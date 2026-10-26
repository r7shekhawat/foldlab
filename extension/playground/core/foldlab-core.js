/*!
 * FoldLab core — device geometry, fold math and Chrome DevTools Protocol mapping.
 * Zero dependencies. Works in browsers (window.FoldLab) and Node (require).
 *
 * Terminology
 *   mode      One physical state of a device (cover screen, unfolded, half-folded...).
 *   hinge     The fold line: { orientation: 'vertical' | 'horizontal', offset, length }
 *             offset = CSS px from the top/left edge to where the hinge region starts,
 *             length = CSS px of screen the hinge physically hides (0 = seamless fold).
 *   segment   A usable region of the screen on one side of the hinge (like
 *             window.visualViewport.segments in the Viewport Segments API).
 *   posture   'continuous' (flat) or 'folded' (half-folded), as in the Device Posture API.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FoldLab = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var POSTURES = ['continuous', 'folded'];
  var ORIENTATIONS = ['vertical', 'horizontal'];

  function round(n) {
    return Math.round(n * 100) / 100;
  }

  /** Resolve hinge.offset === 'center' and defaults. Returns null for no hinge. */
  function resolveHinge(mode) {
    var h = mode && mode.hinge;
    if (!h) return null;
    var length = h.length || 0;
    var axis = h.orientation === 'vertical' ? mode.width : mode.height;
    var offset = h.offset === 'center' || h.offset == null ? (axis - length) / 2 : h.offset;
    return { orientation: h.orientation, offset: round(offset), length: round(length) };
  }

  /**
   * Layout hinge for CSS / page state. Physical hinge wins; otherwise a seamless
   * crease becomes a zero-length hinge so fold-aware demos can split into two panes
   * while flat. CDP emulation keeps using resolveHinge (physical only).
   */
  function resolveLayoutHinge(mode) {
    var h = resolveHinge(mode);
    if (h) return h;
    if (!mode || !mode.crease) return null;
    var axis = mode.crease === 'vertical' ? mode.width : mode.height;
    return { orientation: mode.crease, offset: round(axis / 2), length: 0 };
  }

  /** Hinge rectangle in CSS px relative to the screen's top-left corner. */
  function hingeRect(mode) {
    var h = resolveLayoutHinge(mode);
    if (!h) return null;
    return h.orientation === 'vertical'
      ? { x: h.offset, y: 0, width: h.length, height: mode.height }
      : { x: 0, y: h.offset, width: mode.width, height: h.length };
  }

  /** Usable regions on each side of the hinge (what visualViewport.segments reports). */
  function computeSegments(mode) {
    var h = resolveLayoutHinge(mode);
    if (!h) return [{ x: 0, y: 0, width: mode.width, height: mode.height }];
    if (h.orientation === 'vertical') {
      return [
        { x: 0, y: 0, width: h.offset, height: mode.height },
        {
          x: round(h.offset + h.length),
          y: 0,
          width: round(mode.width - h.offset - h.length),
          height: mode.height
        }
      ];
    }
    return [
      { x: 0, y: 0, width: mode.width, height: h.offset },
      {
        x: 0,
        y: round(h.offset + h.length),
        width: mode.width,
        height: round(mode.height - h.offset - h.length)
      }
    ];
  }

  /**
   * Rotate a mode 90 degrees clockwise. Width/height swap and the hinge flips axis:
   * a vertical hinge at x=o becomes a horizontal hinge at y=o;
   * a horizontal hinge at y=o becomes a vertical hinge at x = oldHeight - o - length.
   */
  function rotate(mode) {
    var h = resolveHinge(mode);
    var out = {};
    for (var k in mode) if (Object.prototype.hasOwnProperty.call(mode, k)) out[k] = mode[k];
    out.width = mode.height;
    out.height = mode.width;
    out.rotated = !mode.rotated;
    if (h) {
      out.hinge =
        h.orientation === 'vertical'
          ? { orientation: 'horizontal', offset: h.offset, length: h.length }
          : { orientation: 'vertical', offset: round(mode.height - h.offset - h.length), length: h.length };
    }
    return out;
  }

  /** Linear interpolation between two modes' sizes, used for fold/unfold animation. */
  function lerpSize(a, b, t) {
    return {
      width: round(a.width + (b.width - a.width) * t),
      height: round(a.height + (b.height - a.height) * t)
    };
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /**
   * The state object FoldLab sends to pages (postMessage) and the foldlab-client reads.
   * Everything is in CSS pixels.
   */
  function toPageState(device, mode) {
    var h = resolveLayoutHinge(mode);
    return {
      simulated: true,
      device: device ? device.name : null,
      mode: mode.id,
      label: mode.label,
      width: mode.width,
      height: mode.height,
      dpr: mode.dpr,
      posture: mode.posture || 'continuous',
      orientation: h ? h.orientation : null,
      hinge: hingeRect(mode),
      segments: computeSegments(mode)
    };
  }

  /**
   * Map a mode to Chrome DevTools Protocol commands.
   * Used by the extension (chrome.debugger.sendCommand).
   *  - Emulation.setDeviceMetricsOverride with displayFeature  -> hinge + viewport segments
   *  - Emulation.setDevicePostureOverride                       -> navigator.devicePosture
   *  - Overlay.setShowHinge                                     -> the visual hinge overlay
   */
  function toCdp(mode, opts) {
    opts = opts || {};
    var h = resolveHinge(mode);
    var metrics = {
      width: Math.round(mode.width),
      height: Math.round(mode.height),
      deviceScaleFactor: mode.dpr || 1,
      mobile: mode.ua !== 'desktop',
      screenWidth: Math.round(mode.width),
      screenHeight: Math.round(mode.height),
      positionX: 0,
      positionY: 0
    };
    if (h) {
      metrics.displayFeature = {
        orientation: h.orientation,
        offset: Math.round(h.offset),
        maskLength: Math.round(h.length)
      };
    }
    var rect = hingeRect(mode);
    return {
      metrics: metrics,
      posture: { type: mode.posture || 'continuous' },
      hingeOverlay: rect && opts.overlay !== false
        ? {
            rect: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.max(Math.round(rect.width), 2),
              height: Math.max(Math.round(rect.height), 2)
            },
            contentColor: { r: 20, g: 20, b: 28, a: 0.92 },
            outlineColor: { r: 255, g: 120, b: 40, a: 0.9 }
          }
        : null
    };
  }

  /** CSS custom properties that foldlab-client sets on <html>. */
  function toCssVars(state) {
    var vars = {
      '--fold-segments': String(state.segments.length),
      '--fold-posture': state.posture,
      '--fold-orientation': state.orientation || 'none'
    };
    state.segments.forEach(function (s, i) {
      vars['--fold-seg' + i + '-x'] = s.x + 'px';
      vars['--fold-seg' + i + '-y'] = s.y + 'px';
      vars['--fold-seg' + i + '-w'] = s.width + 'px';
      vars['--fold-seg' + i + '-h'] = s.height + 'px';
    });
    var hr = state.hinge;
    vars['--fold-hinge-x'] = (hr ? hr.x : 0) + 'px';
    vars['--fold-hinge-y'] = (hr ? hr.y : 0) + 'px';
    vars['--fold-hinge-w'] = (hr ? hr.width : 0) + 'px';
    vars['--fold-hinge-h'] = (hr ? hr.height : 0) + 'px';
    return vars;
  }

  /** The canonical "closed" and "open" modes for a device (used by the fold button). */
  function foldPair(device) {
    var modes = device.modes;
    var closed = modes.find(function (m) { return m.role === 'closed'; });
    var open = modes.find(function (m) { return m.role === 'open'; });
    return { closed: closed || modes[0], open: open || modes[modes.length - 1] };
  }

  /** Returns a list of human-readable problems with a device profile (empty = valid). */
  function validateDevice(d) {
    var errs = [];
    var where = d && d.id ? d.id : '(no id)';
    function err(m) { errs.push(where + ': ' + m); }
    if (!d || typeof d !== 'object') return ['device is not an object'];
    if (!/^[a-z0-9][a-z0-9-]*$/.test(d.id || '')) err('id must be kebab-case');
    if (!d.name) err('missing name');
    if (!d.brand) err('missing brand');
    if (!d.type) err('missing type');
    if (!Array.isArray(d.modes) || !d.modes.length) {
      err('needs at least one mode');
      return errs;
    }
    var seen = {};
    d.modes.forEach(function (m) {
      var label = where + '/' + (m.id || '?');
      if (!m.id) errs.push(where + ': a mode is missing id');
      if (seen[m.id]) errs.push(label + ': duplicate mode id');
      seen[m.id] = true;
      if (!m.label) errs.push(label + ': missing label');
      if (!(m.width > 0) || !(m.height > 0)) errs.push(label + ': width/height must be > 0');
      if (!(m.dpr > 0)) errs.push(label + ': dpr must be > 0');
      if (m.posture && POSTURES.indexOf(m.posture) === -1) errs.push(label + ': bad posture');
      if (m.hinge) {
        if (ORIENTATIONS.indexOf(m.hinge.orientation) === -1) errs.push(label + ': bad hinge orientation');
        var axis = m.hinge.orientation === 'vertical' ? m.width : m.height;
        var len = m.hinge.length || 0;
        var off = m.hinge.offset === 'center' || m.hinge.offset == null ? (axis - len) / 2 : m.hinge.offset;
        if (off < 0 || off + len > axis + 0.001) errs.push(label + ': hinge falls outside the screen');
      }
    });
    return errs;
  }

  return {
    resolveHinge: resolveHinge,
    resolveLayoutHinge: resolveLayoutHinge,
    hingeRect: hingeRect,
    computeSegments: computeSegments,
    rotate: rotate,
    lerpSize: lerpSize,
    easeInOutCubic: easeInOutCubic,
    toPageState: toPageState,
    toCdp: toCdp,
    toCssVars: toCssVars,
    foldPair: foldPair,
    validateDevice: validateDevice
  };
});
