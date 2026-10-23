// tiny static server for local preview (F5 in VS Code): node serve.mjs [port]
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'site');
const port = Number(process.argv[2] ?? process.env.PORT ?? 8080);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.js': 'application/javascript', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

const UMAMI = 'https://umami.dzev.net';

createServer(async (req, res) => {
  // same first-party proxy as nginx.conf: /stats/* -> Umami
  if (req.url?.startsWith('/stats/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    try {
      const up = await fetch(UMAMI + req.url.slice('/stats'.length), {
        method: req.method,
        headers: Object.fromEntries(['content-type', 'content-encoding', 'user-agent', 'accept-language', 'x-umami-cache', 'authorization'].filter((h) => req.headers[h]).map((h) => [h, String(req.headers[h])])),
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body
      });
      if (up.status >= 400) console.log(req.method, req.url, up.status);
      const ct = up.headers.get('content-type') ?? 'text/plain';
      const data = Buffer.from(await up.arrayBuffer());
      const js = ct.includes('javascript');
      const gz = js && String(req.headers['accept-encoding']).includes('gzip');
      res.writeHead(up.status, { 'content-type': ct, 'cache-control': js ? 'public, max-age=86400' : 'no-store', ...(gz ? { 'content-encoding': 'gzip' } : {}) });
      res.end(gz ? gzipSync(data) : data);
    } catch {
      res.writeHead(502);
      res.end('analytics unavailable');
    }
    return;
  }
  const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  // folders: /page -> /page/ like nginx
  if (!path.endsWith('/') && !extname(path)) { res.writeHead(301, { location: `${path}/` }); res.end(); return; }
  const file = join(root, path.endsWith('/') ? `${path}index.html` : path);
  try {
    // the Docker build swaps __DOMAIN__ in; do the same here so the preview matches
    let body = await readFile(file);
    if (/\.(html|txt|xml|webmanifest)$/.test(file)) body = Buffer.from(body.toString().replaceAll('__DOMAIN__', `http://localhost:${port}`).replaceAll('__LASTMOD__', new Date().toISOString().slice(0, 10)));
    const ext = extname(file);
    const text = /\.(html|css|svg|txt|xml)$/.test(file);
    const gz = text && String(req.headers['accept-encoding']).includes('gzip');
    // html is never cached (edit + refresh); images and the like are, as nginx does
    res.writeHead(200, {
      'content-type': types[ext] ?? 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-store' : /\.(avif|webp|png|jpe?g|svg)$/.test(file) ? 'public, max-age=2592000, immutable' : 'public, max-age=86400',
      ...(gz ? { 'content-encoding': 'gzip' } : {})
    });
    res.end(gz ? gzipSync(body) : body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
