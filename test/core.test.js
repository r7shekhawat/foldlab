'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const FoldLab = require('../core/foldlab-core.js');
const data = require('../core/devices.json');

const duo = data.devices.find((d) => d.id === 'microsoft-surface-duo');
const duoSpanned = duo.modes.find((m) => m.id === 'spanned');

test('every device profile is valid and ids are unique', () => {
  const ids = new Set();
  for (const d of data.devices) {
    assert.deepEqual(FoldLab.validateDevice(d), [], d.id);
    assert.ok(!ids.has(d.id), 'duplicate id ' + d.id);
    ids.add(d.id);
  }
  assert.ok(data.devices.length >= 10);
});

test('every device has a closed and open mode for the fold button', () => {
  for (const d of data.devices) {
    const { closed, open } = FoldLab.foldPair(d);
    assert.ok(closed && open, d.id);
    assert.notEqual(closed.id, open.id, d.id);
  }
});

test('Surface Duo spanned splits into two 540px segments around a 34px hinge', () => {
  const segs = FoldLab.computeSegments(duoSpanned);
  assert.equal(segs.length, 2);
  assert.deepEqual(segs[0], { x: 0, y: 0, width: 540, height: 720 });
  assert.deepEqual(segs[1], { x: 574, y: 0, width: 540, height: 720 });
});

test('a mode without a hinge has exactly one full-screen segment', () => {
  const single = duo.modes.find((m) => m.id === 'single');
  assert.deepEqual(FoldLab.computeSegments(single), [{ x: 0, y: 0, width: 540, height: 720 }]);
  assert.equal(FoldLab.hingeRect(single), null);
});

test('hinge offset "center" resolves to the middle of the axis', () => {
  const m = { id: 't', width: 800, height: 600, dpr: 2, hinge: { orientation: 'horizontal', offset: 'center', length: 20 } };
  assert.deepEqual(FoldLab.resolveHinge(m), { orientation: 'horizontal', offset: 290, length: 20 });
  assert.deepEqual(FoldLab.hingeRect(m), { x: 0, y: 290, width: 800, height: 20 });
});

test('rotate swaps size and flips a vertical hinge to horizontal', () => {
  const r = FoldLab.rotate(duoSpanned);
  assert.equal(r.width, 720);
  assert.equal(r.height, 1114);
  assert.deepEqual(r.hinge, { orientation: 'horizontal', offset: 540, length: 34 });
  assert.equal(r.rotated, true);
});

test('rotating twice returns to the original geometry', () => {
  const back = FoldLab.rotate(FoldLab.rotate(duoSpanned));
  assert.equal(back.width, duoSpanned.width);
  assert.equal(back.height, duoSpanned.height);
  assert.deepEqual(back.hinge, duoSpanned.hinge);
});

test('rotate keeps the hinge inside the screen for every device', () => {
  for (const d of data.devices) {
    for (const m of d.modes) {
      const r = FoldLab.rotate(m);
      assert.deepEqual(FoldLab.validateDevice({ ...d, modes: [r] }), [], d.id + '/' + m.id);
    }
  }
});

test('toCdp emits displayFeature, posture and a hinge overlay', () => {
  const cdp = FoldLab.toCdp(duoSpanned);
  assert.equal(cdp.metrics.width, 1114);
  assert.equal(cdp.metrics.deviceScaleFactor, 2.5);
  assert.equal(cdp.metrics.mobile, true);
  assert.deepEqual(cdp.metrics.displayFeature, { orientation: 'vertical', offset: 540, maskLength: 34 });
  assert.deepEqual(cdp.posture, { type: 'continuous' });
  assert.deepEqual(cdp.hingeOverlay.rect, { x: 540, y: 0, width: 34, height: 720 });
});

test('toCdp leaves displayFeature off when there is no hinge and omits overlay', () => {
  const cover = data.devices[0].modes[0];
  const cdp = FoldLab.toCdp(cover);
  assert.equal(cdp.metrics.displayFeature, undefined);
  assert.equal(cdp.hingeOverlay, null);
  assert.deepEqual(cdp.posture, { type: 'folded' });
});

test('toCdp can disable the overlay', () => {
  assert.equal(FoldLab.toCdp(duoSpanned, { overlay: false }).hingeOverlay, null);
});

test('flex modes report a folded posture and a seamless horizontal hinge', () => {
  const fold = data.devices.find((d) => d.id === 'samsung-galaxy-z-fold-6');
  const flex = fold.modes.find((m) => m.id === 'flex');
  const state = FoldLab.toPageState(fold, flex);
  assert.equal(state.posture, 'folded');
  assert.equal(state.orientation, 'horizontal');
  assert.equal(state.segments.length, 2);
  assert.equal(state.segments[0].height + state.segments[1].height, flex.height);
});

test('toCssVars exposes segment and hinge variables', () => {
  const state = FoldLab.toPageState(duo, duoSpanned);
  const vars = FoldLab.toCssVars(state);
  assert.equal(vars['--fold-segments'], '2');
  assert.equal(vars['--fold-seg0-w'], '540px');
  assert.equal(vars['--fold-seg1-x'], '574px');
  assert.equal(vars['--fold-hinge-w'], '34px');
  assert.equal(vars['--fold-orientation'], 'vertical');
});

test('lerpSize and easing are well-behaved at the endpoints', () => {
  const a = { width: 100, height: 200 };
  const b = { width: 300, height: 400 };
  assert.deepEqual(FoldLab.lerpSize(a, b, 0), a);
  assert.deepEqual(FoldLab.lerpSize(a, b, 1), b);
  assert.equal(FoldLab.easeInOutCubic(0), 0);
  assert.equal(FoldLab.easeInOutCubic(1), 1);
});

test('validateDevice catches a hinge outside the screen', () => {
  const bad = { id: 'bad', name: 'Bad', brand: 'X', type: 'book', modes: [
    { id: 'm', label: 'M', width: 100, height: 100, dpr: 1, hinge: { orientation: 'vertical', offset: 90, length: 30 } }
  ] };
  assert.ok(FoldLab.validateDevice(bad).some((e) => /outside/.test(e)));
});
