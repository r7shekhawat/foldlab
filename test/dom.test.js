'use strict';
// DOM smoke tests for the playground UI and foldlab-client.js.
// Requires the dev dependency jsdom (npm install); skipped automatically if it is missing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) { /* skipped below */ }
const maybe = JSDOM ? test : test.skip;

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const devicesJson = read('core/devices.json');
const FoldLab = require('../core/foldlab-core.js');
const data = JSON.parse(devicesJson);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bootPlayground() {
  const dom = new JSDOM(read('web/index.html').replace(/<script[^>]*><\/script>/g, ''), {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'http://localhost/web/index.html'
  });
  const w = dom.window;
  w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(devicesJson)) });
  w.eval(read('core/foldlab-core.js'));
  w.eval(read('web/app.js'));
  await sleep(30);
  return w;
}

const text = (w, id) => w.document.getElementById(id).textContent;

maybe('playground lists every device and opens the default one unfolded', async () => {
  const w = await bootPlayground();
  const buttons = w.document.querySelectorAll('#rail .dev');
  assert.equal(buttons.length, data.devices.length);
  const pressed = w.document.querySelector('#rail .dev[aria-pressed="true"]');
  assert.equal(pressed.textContent.startsWith('Galaxy Z Fold 7'), true);
  assert.match(text(w, 'readout'), /750 × 832 css px/);
  assert.equal(w.document.getElementById('screen').style.width, '750px');
});

maybe('fold button animates to the cover screen and back', async () => {
  const w = await bootPlayground();
  w.document.getElementById('foldBtn').click();
  await sleep(900);
  assert.match(text(w, 'readout'), /Cover screen/);
  assert.match(text(w, 'readout'), /411 × 960 css px/);
  assert.equal(w.document.getElementById('foldBtn').textContent, 'Unfold');
  w.document.getElementById('foldBtn').click();
  await sleep(900);
  assert.match(text(w, 'readout'), /750 × 832 css px/);
});

maybe('dual-screen device shows a 34px hinge gap and rotates it', async () => {
  const w = await bootPlayground();
  const animate = w.document.getElementById('optAnimate');
  animate.checked = false;
  animate.dispatchEvent(new w.Event('change'));
  [...w.document.querySelectorAll('#rail .dev')].find((b) => b.textContent.startsWith('Surface Duo2020') || b.textContent.startsWith('Surface Duo')).click();
  const hinge = w.document.getElementById('hinge');
  assert.equal(hinge.hidden, false);
  assert.ok(hinge.classList.contains('gap'));
  assert.match(hinge.style.cssText, /left:\s*540px/);
  assert.match(hinge.style.cssText, /width:\s*34px/);
  assert.match(text(w, 'readout'), /1114 × 720 css px/);
  w.document.getElementById('rotateBtn').click();
  assert.match(hinge.style.cssText, /top:\s*540px/);
  assert.match(hinge.style.cssText, /height:\s*34px/);
  assert.match(text(w, 'readout'), /720 × 1114 css px/);
});

maybe('flat modes hide the hinge; flex modes show a seam', async () => {
  const w = await bootPlayground();
  const animate = w.document.getElementById('optAnimate');
  animate.checked = false;
  animate.dispatchEvent(new w.Event('change'));
  const hinge = w.document.getElementById('hinge');
  assert.equal(hinge.hidden, true);
  const flex = [...w.document.querySelectorAll('#modes button')].find((b) => /Flex/.test(b.textContent));
  flex.click();
  assert.equal(hinge.hidden, false);
  assert.ok(hinge.classList.contains('seam'));
  assert.match(text(w, 'readout'), /Posture\s*folded/);
});

maybe('share link round-trips device, mode and rotation through the hash', async () => {
  const w = await bootPlayground();
  const animate = w.document.getElementById('optAnimate');
  animate.checked = false;
  animate.dispatchEvent(new w.Event('change'));
  [...w.document.querySelectorAll('#rail .dev')].find((b) => b.textContent.startsWith('Pixel Fold')).click();
  w.document.getElementById('rotateBtn').click();
  const p = new URLSearchParams(w.location.hash.slice(1));
  assert.equal(p.get('d'), 'google-pixel-fold');
  assert.equal(p.get('m'), 'unfolded');
  assert.equal(p.get('r'), '1');
});

maybe('grid view renders a card per device mode', async () => {
  const w = await bootPlayground();
  w.document.getElementById('viewGrid').click();
  const total = data.devices.reduce((n, d) => n + d.modes.length, 0);
  assert.equal(w.document.querySelectorAll('#grid .card').length, total);
  assert.equal(w.document.getElementById('grid').hidden, false);
  assert.equal(w.document.getElementById('single').hidden, true);
});

function bootClient() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'http://localhost/demo.html'
  });
  dom.window.eval(read('web/foldlab-client.js'));
  return dom.window;
}

function send(w, state) {
  w.dispatchEvent(new w.MessageEvent('message', { data: { type: 'foldlab:state', state }, source: w }));
}

maybe('client starts unfolded, then follows simulated state', () => {
  const w = bootClient();
  const root = w.document.documentElement;
  assert.equal(root.getAttribute('data-fold-segments'), '1');
  assert.equal(w.foldlab.isSimulated, false);

  const duo = data.devices.find((d) => d.id === 'microsoft-surface-duo');
  const state = FoldLab.toPageState(duo, duo.modes.find((m) => m.id === 'spanned'));
  let calls = 0;
  w.foldlab.onChange(() => calls++);
  send(w, state);

  assert.equal(w.foldlab.isSimulated, true);
  assert.equal(calls, 1);
  assert.equal(root.getAttribute('data-fold-segments'), '2');
  assert.equal(root.getAttribute('data-fold-orientation'), 'vertical');
  assert.equal(root.style.getPropertyValue('--fold-seg0-w'), '540px');
  assert.equal(root.style.getPropertyValue('--fold-hinge-w'), '34px');
  assert.equal(root.style.getPropertyValue('--fold-seg1-x'), '574px');
});

maybe('client shims matchMedia for segment and posture queries', () => {
  const w = bootClient();
  const fold = data.devices.find((d) => d.id === 'samsung-galaxy-z-fold-6');
  const flat = FoldLab.toPageState(fold, fold.modes.find((m) => m.id === 'unfolded'));
  const flex = FoldLab.toPageState(fold, fold.modes.find((m) => m.id === 'flex'));

  send(w, flat);
  assert.equal(w.matchMedia('(horizontal-viewport-segments: 2)').matches, false);
  assert.equal(w.matchMedia('(device-posture: continuous)').matches, true);

  const mql = w.matchMedia('(vertical-viewport-segments: 2)');
  const seen = [];
  mql.addEventListener('change', (e) => seen.push(e.matches));
  const folded = w.matchMedia('(device-posture: folded)');
  assert.equal(mql.matches, false);
  assert.equal(folded.matches, false);

  send(w, flex);
  assert.equal(mql.matches, true);
  assert.equal(folded.matches, true);
  assert.deepEqual(seen, [true]);
  assert.equal(w.matchMedia('(horizontal-viewport-segments: 2)').matches, false);
  assert.equal(w.matchMedia('(min-vertical-viewport-segments: 2), (device-posture: continuous)').matches, true);
  assert.equal(w.navigator.devicePosture.type, 'folded');
});

maybe('client ignores messages that do not come from the parent window', () => {
  const w = bootClient();
  const other = new JSDOM('').window;
  const duo = data.devices.find((d) => d.id === 'microsoft-surface-duo');
  const state = FoldLab.toPageState(duo, duo.modes.find((m) => m.id === 'spanned'));
  w.dispatchEvent(new w.MessageEvent('message', { data: { type: 'foldlab:state', state }, source: other }));
  assert.equal(w.document.documentElement.getAttribute('data-fold-segments'), '1');
});
