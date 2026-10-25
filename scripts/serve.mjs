// Minimal static server for local testing: node scripts/serve.mjs [port] [dir]
// Serves the site under /whencode/ to mirror the GitHub Pages path.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2] || 8765);
const root = process.argv[3] || fileURLToPath(new URL('../site/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.ics': 'text/calendar' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/' ) { res.writeHead(302, { location: '/whencode/' }); return res.end(); }
  if (!url.pathname.startsWith('/whencode/')) { res.writeHead(404); return res.end('not found'); }
  let p = normalize(decodeURIComponent(url.pathname.slice('/whencode/'.length)));
  if (p.startsWith('..')) { res.writeHead(403); return res.end(); }
  let file = join(root, p);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/whencode/`));
