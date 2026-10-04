import { mkdir, copyFile, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const site = resolve(root, 'site');
const vendor = resolve(site, 'vendor/three');
await mkdir(vendor, { recursive: true });
for (const name of ['three.module.js', 'three.core.js']) await copyFile(resolve(root, 'node_modules/three/build', name), resolve(vendor, name));
await copyFile(resolve(root, 'node_modules/three/LICENSE'), resolve(vendor, 'LICENSE'));
if (process.argv.includes('--prepare')) { console.log('Local Three.js modules and license prepared.'); process.exit(0); }

async function files(dir) {
  let all = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, item.name);
    all = all.concat(item.isDirectory() ? await files(path) : [path]);
  }
  return all.sort();
}
const readme = resolve(root, 'README.md');
const entries = [...await files(site), readme];
for (const path of entries.filter(p => /\.(js|html|css)$/.test(p) && !p.includes('/vendor/'))) {
  const text = await readFile(path, 'utf8');
  const imports = [...text.matchAll(/(?:from\s*|import\s*\(|src=|href=)["'](\.\.?\/[^"']+)["']/g)];
  for (const match of imports) {
    const target = resolve(dirname(path), match[1]);
    if (!(await stat(target)).isFile()) throw new Error(`Missing relative resource: ${relative(site, path)} -> ${match[1]}`);
  }
}
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let value = i;
  for (let j = 0; j < 8; j++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(data) { let crc = 0xffffffff; for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
const chunks = [], central = [];
let offset = 0;
for (const path of entries) {
  const data = await readFile(path), compressed = deflateRawSync(data), name = Buffer.from(path === readme ? 'README.md' : relative(site, path).replaceAll('\\', '/'));
  const crc = crc32(data), header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8); header.writeUInt16LE(0x21, 12);
  header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
  chunks.push(header, name, compressed);
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(8, 10); c.writeUInt16LE(0x21, 14);
  c.writeUInt32LE(crc, 16); c.writeUInt32LE(compressed.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
  central.push(c, name); offset += header.length + name.length + compressed.length;
}
const directory = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
const archive = Buffer.concat([...chunks, directory, end]);
const target = resolve(root, 'campus-horror-pages.zip');
await writeFile(target, archive);
console.log(`Packaged ${entries.length} files (${(archive.length / 1024).toFixed(0)} KiB): ${target}`);
