import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export function createStaticServer(root, prefix = '') {
  root = resolve(root);
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };
  return createServer(async (req, res) => {
    try {
      let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (prefix && pathname === prefix) { res.writeHead(302, { Location: prefix + '/' }); res.end(); return; }
      if (prefix && !pathname.startsWith(prefix + '/')) { res.writeHead(404); res.end(); return; }
      pathname = pathname.slice(prefix.length);
      let file = resolve(root, '.' + pathname);
      if (!file.startsWith(root + sep) && file !== root) { res.writeHead(403); res.end(); return; }
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('../site/', import.meta.url));
  const port = Number(process.env.PORT || 4173);
  createStaticServer(root).listen(port, '0.0.0.0', () => console.log(`Campus preview listening on port ${port}`));
}
