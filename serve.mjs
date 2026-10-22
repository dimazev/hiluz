// tiny static server for local preview (F5 in VS Code): node serve.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'site');
const port = Number(process.argv[2] ?? process.env.PORT ?? 8080);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };

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
      res.writeHead(up.status, { 'content-type': up.headers.get('content-type') ?? 'text/plain' });
      res.end(Buffer.from(await up.arrayBuffer()));
    } catch {
      res.writeHead(502);
      res.end('analytics unavailable');
    }
    return;
  }
  const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(root, path.endsWith('/') ? `${path}index.html` : path);
  try {
    // the Docker build swaps __DOMAIN__ in; do the same here so the preview matches
    let body = await readFile(file);
    if (/\.(html|txt|xml)$/.test(file)) body = Buffer.from(body.toString().replaceAll('__DOMAIN__', `http://localhost:${port}`));
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
