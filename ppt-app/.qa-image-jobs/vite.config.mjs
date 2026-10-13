import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({root:here,esbuild:{jsx:'automatic'},resolve:{alias:{'@':path.dirname(here)}},server:{host:'127.0.0.1',port:46751,strictPort:true,fs:{allow:[path.dirname(here)]}}});
