import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    allowedHosts: ['macbook-pro-de-jose.tail406fdf.ts.net'],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4317',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:4317',
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: false,
  },
});
