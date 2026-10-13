import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { chineseLocalePlugin, completeChineseLocale } from './src/excalidraw-locale.js';

const output = fileURLToPath(new URL('../static/drawing-app', import.meta.url));

export default defineConfig({
  base: '/static/drawing-app/',
  optimizeDeps: { esbuildOptions: { plugins: [{
    name: 'excalidraw-chinese-hints',
    setup(build) {
      build.onLoad({ filter: /[\\/]@excalidraw[\\/]excalidraw[\\/]dist[\\/](dev|prod)[\\/]locales[\\/]zh-CN-[^\\/]+\.js$/ }, ({ path }) => ({
        contents: completeChineseLocale(readFileSync(path, 'utf8'), path), loader: 'js', resolveDir: dirname(path),
      }));
    },
  }] } },
  plugins: [chineseLocalePlugin(), react(), {
    name: 'local-excalidraw-fonts',
    closeBundle() {
      cpSync(new URL('./node_modules/@excalidraw/excalidraw/dist/prod/fonts', import.meta.url), `${output}/fonts`, { recursive: true });
      cpSync(new URL('./EXCALIDRAW-LICENSE.txt', import.meta.url), `${output}/EXCALIDRAW-LICENSE.txt`);
    },
  }],
  define: { 'process.env.IS_PREACT': 'false' },
  build: { outDir: output, emptyOutDir: true },
});
