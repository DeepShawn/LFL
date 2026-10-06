import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function productionServer() {
  if (process.env.QA_URL) return { url: process.env.QA_URL, close: async () => {} };
  const root = path.resolve('dist');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary' };
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
    if (!pathname.startsWith('/LFL/')) { response.writeHead(404); response.end(); return; }
    const file = path.resolve(root, pathname.slice(5) || 'index.html');
    if (!file.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
    try { const data = await readFile(file); response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); response.end(data); }
    catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/LFL/`, close: () => new Promise(resolve => server.close(resolve)) };
}
