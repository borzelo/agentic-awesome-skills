import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  publicDir: false,
  build: {
    outDir: '../../.tmp/aas-plugin', emptyOutDir: false,
    rollupOptions: { input: fileURLToPath(new URL('./workbench.html', import.meta.url)) },
  },
});
