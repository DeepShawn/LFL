import { access, stat } from 'node:fs/promises';

const files = [
  'public/assets/models/optimized/classroom.glb',
  'public/assets/models/optimized/corridor.glb',
  'public/assets/models/optimized/office.glb',
  'public/assets/models/optimized/exterior_block.glb',
  'public/assets/models/optimized/school_scene.glb',
  'public/assets/models/optimized/school_collision.glb',
  'public/assets/models/metadata.json',
  'public/vendor/three.module.js',
  'public/vendor/GLTFLoader.js',
];

for (const file of files) {
  await access(file);
  const info = await stat(file);
  if (info.size === 0) throw new Error(`${file} is empty`);
  console.log(`${file}: ${info.size} bytes`);
}

console.log(`Validated ${files.length} runtime assets.`);
