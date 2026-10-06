import { readFile, stat } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import validator from 'gltf-validator';

const manifest = JSON.parse(await readFile('public/assets/models/manifest.json', 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
let total = 0;
for (const tier of ['desktop', 'mobile']) {
  for (const [name, asset] of Object.entries(manifest.tiers[tier])) {
    const file = `public/${asset.path}`;
    const bytes = await readFile(file);
    if (bytes.length !== asset.bytes || !bytes.length) throw new Error(`${file}: size mismatch`);
    const report = await validator.validateBytes(bytes, { uri: file, maxIssues: 20 });
    if (report.issues.numErrors) throw new Error(`${file}: ${JSON.stringify(report.issues)}`);
    const doc = await io.read(file);
    if (!doc.getRoot().listMeshes().length || !doc.getRoot().listMaterials().length) throw new Error(`${file}: missing geometry/material`);
    if (doc.getRoot().listTextures().some(t => t.getURI().startsWith('http'))) throw new Error(`${file}: external texture dependency`);
    if (!doc.getRoot().listExtensionsRequired().some(e => e.extensionName === 'EXT_meshopt_compression')) throw new Error(`${file}: Meshopt missing`);
    console.log(`${tier}/${name}: ${asset.bytes} bytes, ${asset.primitives} primitives, ${asset.triangles} triangles, ${asset.materials} materials; validator: 0 errors`);
    total++;
  }
}
const collision = JSON.parse(await readFile('public/assets/models/collision.json', 'utf8'));
for (const room of ['classroom', 'corridor', 'office']) {
  if (collision[room].bounds.length !== 4 || !Array.isArray(collision[room].obstacles)) throw new Error(`Invalid collision ${room}`);
}
if (!(await stat('node_modules/three/examples/jsm/libs/meshopt_decoder.module.js')).size) throw new Error('Decoder missing');
console.log(`Validated and decoded ${total} optimized GLBs, collision rooms and decoder.`);
