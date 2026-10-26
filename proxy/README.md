# FoldLab frame proxy

Cloudflare Worker that fetches a page, strips `X-Frame-Options` / CSP frame blockers, injects `<base>`, and allows the playground iframe to embed it.

Live: `https://foldlab-proxy.r7foldlab.workers.dev/?url=https://example.com`

The GitHub Pages playground points at this URL. Local `npm start` still uses `/__foldlab_proxy` on the Node server.
