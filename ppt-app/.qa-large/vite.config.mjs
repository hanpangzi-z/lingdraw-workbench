import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({ root: here, esbuild: { jsx: 'automatic' }, resolve: { alias: [
  { find: 'next/navigation', replacement: path.join(here, 'navigation.jsx') },
  { find: '@/components/workflow/CatalogWorkflow', replacement: path.join(here, 'workflow.jsx') },
  { find: '@', replacement: path.dirname(here) },
] }, server: { host: '127.0.0.1', port: 46750, strictPort: true, fs: { allow: [path.dirname(here)] } } });
