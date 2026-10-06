import { defineConfig } from 'vite';
import { cp, mkdir, writeFile } from 'node:fs/promises';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: false,
    copyPublicDir: false,
    rollupOptions: {
      output: { manualChunks: { three: ['three', 'three/addons/loaders/GLTFLoader.js'] } },
    },
  },
  plugins: [{
    name: 'ship-only-runtime-assets',
    async closeBundle() {
      await mkdir('dist/assets/models', { recursive: true });
      for (const name of ['desktop', 'mobile', 'manifest.json', 'collision.json']) {
        await cp(`public/assets/models/${name}`, `dist/assets/models/${name}`, { recursive: true });
      }
      await writeFile('dist/.nojekyll', '');
      await cp('node_modules/three/LICENSE', 'dist/THREE-LICENSE.txt');
    },
  }],
});
