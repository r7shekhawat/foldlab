#!/usr/bin/env node
// Zero-dependency static file server for local development: `npm start`
// Serves the repo root so web/ can reach ../core/. Open http://localhost:5173/web/
// Also proxies external pages at /__foldlab_proxy?url=… so sites that send
// X-Frame-Options / CSP frame-ancestors can still load inside the playground iframe.
'use strict';
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || process.argv[2] || 5173);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon'
};

const BLOCKED_RESP_HEADERS = new Set([
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive'
]);

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function isHtml(ctype) {
  return /text\/html/i.test(ctype || '');
}

function injectBase(html, baseHref) {
  const base = '<base href="' + baseHref.replace(/"/g, '&quot;') + '">';
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + base);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + '<head>' + base + '</head>');
  return base + html;
}

function fetchUrl(target, redirectCount, cb) {
  if (redirectCount > 8) return cb(new Error('Too many redirects'));
  let u;
  try { u = new URL(target); } catch (e) { return cb(new Error('Invalid URL')); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return cb(new Error('Only http(s) URLs are supported'));

  const lib = u.protocol === 'https:' ? https : http;
  const req = lib.request(u, {
    method: 'GET',
    headers: {
      'User-Agent': 'FoldLab-Proxy/0.1 (+local playground; strips frame blockers)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    timeout: 20000
  }, (upstream) => {
    const status = upstream.statusCode || 0;
    if (status >= 300 && status < 400 && upstream.headers.location) {
      upstream.resume();
      const next = new URL(upstream.headers.location, u).href;
      return fetchUrl(next, redirectCount + 1, cb);
    }
    const chunks = [];
    upstream.on('data', (c) => chunks.push(c));
    upstream.on('end', () => {
      cb(null, {
        status,
        headers: upstream.headers,
        body: Buffer.concat(chunks),
        finalUrl: u.href
      });
    });
  });
  req.on('timeout', () => req.destroy(new Error('Upstream timed out')));
  req.on('error', cb);
  req.end();
}

function handleProxy(req, res, pageUrl) {
  fetchUrl(pageUrl, 0, (err, result) => {
    if (err) {
      return send(res, 502, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        '<!doctype html><meta charset=utf-8><title>FoldLab proxy error</title>' +
        '<body style="font:14px system-ui;padding:2rem"><h1>Could not load page</h1><p>' +
        String(err.message).replace(/[<>&]/g, '') + '</p></body>');
    }
    const ctype = result.headers['content-type'] || 'application/octet-stream';
    const outHeaders = {
      'Cache-Control': 'no-store',
      'Content-Type': ctype
    };
    // Explicitly allow framing by the playground.
    outHeaders['Content-Security-Policy'] = "frame-ancestors 'self' http://localhost:* http://127.0.0.1:*";

    let body = result.body;
    if (isHtml(ctype)) {
      let html = body.toString('utf8');
      // Point relative URLs at the real origin so CSS/JS/images still resolve.
      const baseHref = result.finalUrl.replace(/[#?].*$/, '');
      const baseDir = baseHref.endsWith('/') ? baseHref : baseHref.replace(/\/[^/]*$/, '/');
      html = injectBase(html, baseDir);
      // Soften meta http-equiv frame killers when present.
      html = html.replace(/http-equiv\s*=\s*["']?X-Frame-Options["']?/ig, 'data-foldlab-stripped-xfo');
      body = Buffer.from(html, 'utf8');
      outHeaders['Content-Type'] = 'text/html; charset=utf-8';
    }
    outHeaders['Content-Length'] = body.length;
    res.writeHead(result.status >= 400 ? result.status : 200, outHeaders);
    res.end(body);
  });
}

const server = http.createServer((req, res) => {
  let urlPath;
  let pageUrl;
  try {
    const u = new URL(req.url, 'http://x');
    urlPath = decodeURIComponent(u.pathname);
    pageUrl = u.searchParams.get('url');
  } catch (e) {
    return send(res, 400, { 'Content-Type': 'text/plain' }, 'Bad request');
  }

  if (urlPath === '/__foldlab_proxy') {
    if (!pageUrl) return send(res, 400, { 'Content-Type': 'text/plain' }, 'Missing url parameter');
    return handleProxy(req, res, pageUrl);
  }

  const siteMap = {
    '/': 'site/index.html',
    '/index.html': 'site/index.html',
    '/landing.css': 'site/landing.css',
    '/landing.js': 'site/landing.js'
  };
  let file = siteMap[urlPath]
    ? path.join(ROOT, siteMap[urlPath])
    : path.join(ROOT, urlPath);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(buf);
  });
});

server.listen(PORT, () => {
  console.log(`FoldLab playground: http://localhost:${PORT}/web/`);
  console.log(`Frame proxy:        http://localhost:${PORT}/__foldlab_proxy?url=…`);
});
