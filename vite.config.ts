import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: new URL('./index.html', import.meta.url).pathname,
        lab: new URL('./lab.html', import.meta.url).pathname,
      },
    },
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4096,
  },
  worker: { format: 'es' },
  server: { host: true, port: 5173 },
});
