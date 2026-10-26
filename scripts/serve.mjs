import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve('.');
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const filename = resolve(root, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
  if (!filename.startsWith(root + sep) || /(?:^|[\\/])\./.test(pathname) || !(pathname === '/' || pathname === '/index.html' || pathname.startsWith('/assets/'))) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const content = await readFile(filename);
    res.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' }[extname(filename)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(5174, '127.0.0.1', () => console.log('HTML attendance app: http://127.0.0.1:5174/'));
