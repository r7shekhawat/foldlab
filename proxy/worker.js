// FoldLab frame proxy — Cloudflare Worker.
// Fetches a target page, strips frame-blocking headers, injects <base>,
// and allows embedding from the FoldLab playground (GitHub Pages + localhost).
'use strict';

const ALLOWED_FRAME_ANCESTORS = [
  "'self'",
  'https://r7shekhawat.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:8080',
  'http://127.0.0.1:8080'
].join(' ');

function errorPage(message, status) {
  return new Response(
    '<!doctype html><meta charset=utf-8><title>FoldLab proxy error</title>' +
      '<body style="font:14px system-ui;padding:2rem"><h1>Could not load page</h1><p>' +
      String(message).replace(/[<>&]/g, '') + '</p></body>',
    {
      status: status || 502,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': 'frame-ancestors ' + ALLOWED_FRAME_ANCESTORS,
        'Access-Control-Allow-Origin': '*'
      }
    }
  );
}

function injectBase(html, baseHref) {
  const base = '<base href="' + baseHref.replace(/"/g, '&quot;') + '">';
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + base);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + '<head>' + base + '</head>');
  return base + html;
}

async function fetchTarget(target, redirectCount) {
  if (redirectCount > 8) throw new Error('Too many redirects');
  let u;
  try { u = new URL(target); } catch (e) { throw new Error('Invalid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http(s) URLs are supported');

  const res = await fetch(u.href, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      'User-Agent': 'FoldLab-Proxy/0.1 (+playground; strips frame blockers)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });

  if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
    const next = new URL(res.headers.get('location'), u).href;
    return fetchTarget(next, redirectCount + 1);
  }

  return { res, finalUrl: u.href };
}

export default {
  async fetch(request) {
    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Max-Age': '86400'
          }
        });
      }

      if (request.method !== 'GET') {
        return new Response('Method not allowed', { status: 405 });
      }

      const incoming = new URL(request.url);
      const pageUrl = incoming.searchParams.get('url');
      if (!pageUrl) return new Response('Missing url parameter', { status: 400 });

      let result;
      try {
        result = await fetchTarget(pageUrl, 0);
      } catch (e) {
        return errorPage(e.message || String(e));
      }

      const { res, finalUrl } = result;
      const ctype = res.headers.get('content-type') || 'application/octet-stream';
      const headers = {
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Content-Security-Policy': 'frame-ancestors ' + ALLOWED_FRAME_ANCESTORS
      };

      if (/text\/html/i.test(ctype)) {
        let html = await res.text();
        const baseHref = finalUrl.replace(/[#?].*$/, '');
        const baseDir = baseHref.endsWith('/') ? baseHref : baseHref.replace(/\/[^/]*$/, '/');
        html = injectBase(html, baseDir);
        html = html.replace(/http-equiv\s*=\s*["']?X-Frame-Options["']?/ig, 'data-foldlab-stripped-xfo');
        headers['Content-Type'] = 'text/html; charset=utf-8';
        return new Response(html, { status: res.status >= 400 ? res.status : 200, headers });
      }

      headers['Content-Type'] = ctype;
      return new Response(res.body, { status: res.status >= 400 ? res.status : 200, headers });
    } catch (e) {
      return errorPage(e.message || String(e), 500);
    }
  }
};
