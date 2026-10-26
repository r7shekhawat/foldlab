'use strict';
// Drives the side panel against a mocked chrome.* API and checks the Chrome DevTools Protocol
// commands it sends. Skipped automatically when jsdom is not installed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) { /* skipped below */ }
const maybe = JSDOM ? test : test.skip;

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const devicesJson = read('core/devices.json');

async function boot({ tabUrl = 'https://example.com/app', storage = {} } = {}) {
  const html = read('extension/sidepanel.html').replace(/<script[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'chrome-extension://abc/sidepanel.html' });
  const w = dom.window;
  const calls = [];
  const sent = [];
  w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(devicesJson)) });
  w.chrome = {
    storage: { local: { get: async () => storage, set: async () => {} } },
    tabs: {
      query: async () => [{ id: 7, url: tabUrl }],
      get: async (id) => ({ id }),
      onActivated: { addListener() {} }
    },
    debugger: {
      attach: async (t, v) => { calls.push(['attach', t.tabId, v]); },
      detach: async (t) => { calls.push(['detach', t.tabId]); },
      sendCommand: async (target, method, params) => {
        sent.push({ method, params });
        if (method === 'Runtime.evaluate') return { result: { value: JSON.stringify({ s: 2, p: 'continuous', mq: true }) } };
        return {};
      },
      onDetach: { addListener() {} }
    },
    runtime: { sendMessage: (msg, cb) => { calls.push(['message', msg]); cb && cb({ ok: true }); }, lastError: null }
  };
  w.eval(read('core/foldlab-core.js'));
  w.eval(read('extension/sidepanel.js'));
  await sleep(30);
  return { w, calls, sent };
}

const click = (w, id) => w.document.getElementById(id).click();
const plain = (o) => JSON.parse(JSON.stringify(o));
const last = (sent, method) => [...sent].reverse().find((c) => c.method === method);

maybe('side panel populates devices and modes', async () => {
  const { w } = await boot();
  const select = w.document.getElementById('device');
  assert.ok(select.options.length >= 10);
  assert.equal(select.value, 'samsung-galaxy-z-fold-7');
  assert.equal(w.document.querySelectorAll('#modes button').length, 3);
});

maybe('choosing Surface Duo spanned sends displayFeature, posture and hinge overlay', async () => {
  const { w, calls, sent } = await boot();
  w.document.getElementById('optAnimate').checked = false;
  w.document.getElementById('optAnimate').dispatchEvent(new w.Event('change'));
  const select = w.document.getElementById('device');
  select.value = 'microsoft-surface-duo';
  select.dispatchEvent(new w.Event('change'));
  await sleep(400);

  assert.deepEqual(calls[0], ['attach', 7, '1.3']);
  const m = last(sent, 'Emulation.setDeviceMetricsOverride').params;
  assert.equal(m.width, 1114);
  assert.equal(m.height, 720);
  assert.equal(m.deviceScaleFactor, 2.5);
  assert.deepEqual(plain(m.displayFeature), { orientation: 'vertical', offset: 540, maskLength: 34 });
  assert.deepEqual(plain(last(sent, 'Emulation.setDevicePostureOverride').params), { posture: { type: 'continuous' } });
  assert.deepEqual(plain(last(sent, 'Overlay.setShowHinge').params.hingeConfig.rect), { x: 540, y: 0, width: 34, height: 720 });
  assert.match(last(sent, 'Emulation.setUserAgentOverride').params.userAgent, /Android 14/);
  assert.equal(w.document.getElementById('status').className, 'pill on');
  assert.match(w.document.getElementById('readout').textContent, /1114 × 720/);
  assert.match(w.document.getElementById('msg').textContent, /page sees 2 segments/);
});

maybe('fold animation tweens the viewport without a hinge, then lands on the final mode', async () => {
  const { w, sent } = await boot();
  click(w, 'rotate'); // attaches and applies the default unfolded mode (animation has no previous size yet)
  await sleep(1000);
  sent.length = 0;
  click(w, 'fold');
  await sleep(1200);
  const metrics = sent.filter((c) => c.method === 'Emulation.setDeviceMetricsOverride');
  assert.ok(metrics.length >= 10, 'expected several tween steps, got ' + metrics.length);
  assert.ok(metrics.slice(0, -1).every((c) => !c.params.displayFeature));
  const final = metrics[metrics.length - 1].params;
  assert.equal(final.width, 411);
  assert.equal(final.height, 960);
  assert.equal(w.document.getElementById('fold').textContent, 'Unfold');
});

maybe('Z Fold flex mode sends a horizontal seamless hinge and folded posture', async () => {
  const { w, sent } = await boot();
  w.document.getElementById('optAnimate').checked = false;
  w.document.getElementById('optAnimate').dispatchEvent(new w.Event('change'));
  const flex = [...w.document.querySelectorAll('#modes button')].find((b) => /Flex/.test(b.textContent));
  flex.click();
  await sleep(400);
  const m = last(sent, 'Emulation.setDeviceMetricsOverride').params;
  assert.deepEqual(plain(m.displayFeature), { orientation: 'horizontal', offset: 375, maskLength: 0 });
  assert.deepEqual(plain(last(sent, 'Emulation.setDevicePostureOverride').params), { posture: { type: 'folded' } });
});

maybe('refuses chrome:// pages with a clear message', async () => {
  const { w, calls } = await boot({ tabUrl: 'chrome://extensions' });
  w.document.getElementById('optAnimate').checked = false;
  click(w, 'fold');
  await sleep(200);
  assert.equal(calls.filter((c) => c[0] === 'attach').length, 0);
  const msg = w.document.getElementById('msg');
  assert.match(msg.textContent, /regular web page/);
  assert.ok(msg.classList.contains('err'));
});

maybe('warns when the page cannot see viewport segments', async () => {
  const { w, sent } = await boot();
  w.chrome.debugger.sendCommand = async (t, method, params) => {
    sent.push({ method, params });
    if (method === 'Runtime.evaluate') return { result: { value: JSON.stringify({ s: 1, p: null, mq: false }) } };
    return {};
  };
  w.document.getElementById('optAnimate').checked = false;
  w.document.getElementById('optAnimate').dispatchEvent(new w.Event('change'));
  const select = w.document.getElementById('device');
  select.value = 'microsoft-surface-duo';
  select.dispatchEvent(new w.Event('change'));
  await sleep(400);
  assert.match(w.document.getElementById('msg').textContent, /enable-experimental-web-platform-features/);
});

maybe('stop clears emulation and detaches', async () => {
  const { w, calls, sent } = await boot();
  w.document.getElementById('optAnimate').checked = false;
  w.document.getElementById('optAnimate').dispatchEvent(new w.Event('change'));
  click(w, 'fold');
  await sleep(300);
  click(w, 'stop');
  await sleep(200);
  assert.ok(sent.some((c) => c.method === 'Emulation.clearDeviceMetricsOverride'));
  assert.ok(calls.some((c) => c[0] === 'detach' && c[1] === 7));
  assert.equal(w.document.getElementById('status').textContent, 'Not emulating');
});

maybe('all-devices view asks the background worker to open the playground', async () => {
  const { w, calls } = await boot();
  click(w, 'grid');
  await sleep(50);
  const msg = calls.find((c) => c[0] === 'message')[1];
  assert.equal(msg.type, 'foldlab:open-playground');
  assert.equal(msg.url, 'https://example.com/app');
  assert.equal(msg.view, 'grid');
});

maybe('manifest is valid MV3 and its files exist', () => {
  const m = JSON.parse(read('extension/manifest.json'));
  assert.equal(m.manifest_version, 3);
  assert.ok(m.permissions.includes('debugger') && m.permissions.includes('sidePanel'));
  const files = [m.background.service_worker, m.side_panel.default_path, ...Object.values(m.icons), ...Object.values(m.action.default_icon)];
  for (const f of files) assert.ok(fs.existsSync(path.join(root, 'extension', f)), f);
  assert.equal(m.version, JSON.parse(read('package.json')).version);
});
