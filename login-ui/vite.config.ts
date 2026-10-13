import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  base: '/static/login-app/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL('../static/login-app', import.meta.url)),
    emptyOutDir: true,
  },
})
