import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
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
});
