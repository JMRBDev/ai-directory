import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

import preact from '@astrojs/preact';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),

  vite: {
    plugins: [tailwindcss()],
    server: {
      allowedHosts: ['macbook-pro-de-jose.tail406fdf.ts.net'],
    },
  },

  integrations: [preact()],
});