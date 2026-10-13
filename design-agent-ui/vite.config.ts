import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/static/design-agent-app/',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('../static/design-agent-app', import.meta.url)),
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
  },
})
