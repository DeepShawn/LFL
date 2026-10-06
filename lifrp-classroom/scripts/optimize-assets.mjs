import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import validator from 'gltf-validator';

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const root = path.resolve(import.meta.dirname || path.dirname(new URL(import.meta.url).pathname), '..');
const output = path.join(root, 'public/assets/models');
const manifest = { version: 2, codec: 'EXT_meshopt_compression', tiers: {} };
const names = ['classroom', 'corridor', 'office', 'exterior_block'];
for (const tier of ['desktop', 'mobile']) {
  await mkdir(path.join(output, tier), { recursive: true });
  manifest.tiers[tier] = {};
  for (const name of names) {
    const input = path.join(root, `assets/refined/${tier}/${name}.glb`);
    const doc = await io.read(input);
    await doc.transform(dedup(), prune(), weld(), meshopt({ encoder: MeshoptEncoder, level: 'high', quantizePosition: tier === 'mobile' ? 12 : 14 }));
    const dest = path.join(output, tier, `${name}.glb`);
    await io.write(dest, doc);
    const bytes = await readFile(dest);
    const report = await validator.validateBytes(bytes, { uri: `${tier}/${name}.glb`, maxIssues: 40 });
    if (report.issues.numErrors) throw new Error(`${tier}/${name}: ${JSON.stringify(report.issues)}`);
    const decoded = await io.read(dest);
    let primitives = 0, triangles = 0;
    for (const mesh of decoded.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
      primitives++;
      if (prim.getMode() === 4) triangles += (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3;
    }
    const item = { path: `assets/models/${tier}/${name}.glb`, bytes: bytes.length, inputBytes: (await stat(input)).size, primitives, triangles, materials: decoded.getRoot().listMaterials().length, textures: decoded.getRoot().listTextures().length, validationErrors: 0 };
    manifest.tiers[tier][name] = item;
    console.log(`${tier}/${name}: ${item.inputBytes} -> ${item.bytes} bytes; ${primitives} primitives; ${triangles} triangles`);
  }
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));

const collision = {};
for (const name of ['classroom', 'corridor', 'office']) {
  const b = await readFile(path.join(output, `source/${name}.glb`));
  const gltf = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
  const obstacles = [];
  for (const node of gltf.nodes) {
    if (!/Desk.*Top|TeacherDesk_Base|Partition|Cabinet/i.test(node.name || '') || node.mesh === undefined) continue;
    const accessor = gltf.accessors[gltf.meshes[node.mesh].primitives[0].attributes.POSITION];
    if (accessor.max[1] > .3) obstacles.push([accessor.min[0], accessor.max[0], accessor.min[2], accessor.max[2]]);
  }
  collision[name] = { bounds: name === 'classroom' ? [-4.8, 4.8, -3.85, 4] : name === 'office' ? [-4.4, 4.4, -3.6, 3.6] : [-10.7, 10.7, -1.35, 1.35], obstacles };
}
await writeFile(path.join(output, 'collision.json'), JSON.stringify(collision));
console.log('Validated all optimized assets and wrote manifest and collision bounds.');
