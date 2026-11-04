/* Test server: serves an app folder at /practice-pilot/ like GitHub Pages.
   GET /__root?dir=<path> switches the folder (to simulate publishing a new version).
   GET /__mode?m=normal|portal|slow switches network behaviour:
     down = no answer at all (no signal); portal = every request returns a rink Wi-Fi sign-in page; slow = 6 s delay on everything. */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/markdown' };
const PORTAL = '<!doctype html><title>Wi-Fi sign in</title><h1>Welcome to Arena Wi-Fi</h1><p>Accept the terms to continue.</p>';

export function startServer(dir, port = 0) {
  let root = resolve(dir), mode = 'normal';
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/__root') { root = resolve(u.searchParams.get('dir')); res.end('ok'); return; }
    if (u.pathname === '/__mode') { mode = u.searchParams.get('m'); res.end('ok'); return; }
    if (mode === 'down') { req.socket.destroy(); return; }
    if (mode === 'portal') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PORTAL); return; }
    if (mode === 'slow') await new Promise(r => setTimeout(r, 6000));
    if (!u.pathname.startsWith('/practice-pilot/')) { res.writeHead(302, { location: '/practice-pilot/' }); res.end(); return; }
    let p = decodeURIComponent(u.pathname.slice('/practice-pilot/'.length));
    if (p === '' || p.endsWith('/')) p += 'index.html';
    const file = join(root, p);
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    try {
      await stat(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(await readFile(file));
    } catch { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>404</h1>'); }
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r({
    server, url: `http://127.0.0.1:${server.address().port}/practice-pilot/`,
    setRoot: d => { root = resolve(d); }, setMode: m => { mode = m; }, close: () => server.close(),
  })));
}

if (process.argv[1] && process.argv[1].endsWith('server.mjs')) {
  const s = await startServer(process.argv[2] || '.', Number(process.argv[3] || 8123));
  console.log(s.url);
}
