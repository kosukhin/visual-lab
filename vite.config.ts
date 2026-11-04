import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/',
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/@sqlite.org/sqlite-wasm')) return 'sqlite';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  preview: {
    port: 4173,
    host: true,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'Visual Lab — 3D-проводник',
        short_name: 'Visual Lab',
        description:
          '3D-мир с ИИ-проводником на Gemini Nano: визуализации по запросу, сохранение в SQLite',
        lang: 'ru',
        theme_color: '#0b0f1a',
        background_color: '#0b0f1a',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'any',
        start_url: '/',
        scope: '/',
        categories: ['productivity', 'education', 'graphics'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,webmanifest}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
});
