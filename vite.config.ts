import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Префикс, под которым живёт production-сборка.
 *
 * GitHub Pages для репозитория отдаёт сайт из подкаталога `/<repo>/`, поэтому по
 * умолчанию собираем под `kosukhin/visual-lab` → https://kosukhin.github.io/visual-lab/
 *
 * Другой путь (свой домен, user-site `kosukhin.github.io`, переименованный форк):
 *   BASE_PATH=/ npm run build
 *   BASE_PATH=/my-fork/ npm run build
 */
const BASE_PATH = normalizeBase(process.env.BASE_PATH ?? '/visual-lab/');

/** '/visual-lab' → '/visual-lab/': Vite и manifest ждут префикс со слэшем на конце. */
function normalizeBase(path: string): string {
  const withLeading = path.startsWith('/') ? path : `/${path}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

export default defineConfig(({ command, isPreview }) => {
  // dev — на корне (http://localhost:5173), preview — уже с боевым префиксом,
  // чтобы локально проверялась именно та сборка, что уедет на GitHub Pages:
  // http://localhost:4173/visual-lab/
  const base = command === 'build' || isPreview ? BASE_PATH : '/';

  return {
    base,
    build: {
      target: 'es2022',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules/three')) return 'three';
            if (id.includes('node_modules/@sqlite.org/sqlite-wasm')) return 'sqlite';
            if (id.includes('node_modules/@wllama/wllama')) return 'wllama';
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
          // start_url/scope/icons обязаны учитывать base, иначе PWA и иконки
          // ломаются при размещении в подкаталоге GitHub Pages.
          start_url: base,
          scope: base,
          categories: ['productivity', 'education', 'graphics'],
          icons: [
            {
              src: `${base}icons/icon-192.png`,
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: `${base}icons/icon-512.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: `${base}icons/icon-maskable-512.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,wasm,webmanifest}'],
          // Движок локальной модели весит ~8.7 МБ и нужен не всем: не кладём его
          // в precache, а кэшируем при первом обращении (см. runtimeCaching).
          globIgnores: ['**/wllama-*.wasm'],
          runtimeCaching: [
            {
              urlPattern: /\/assets\/wllama-[^/]+\.wasm$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'wasm-engines',
                expiration: { maxEntries: 4 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
          maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
          cleanupOutdatedCaches: true,
          // Путь относительный: service worker лежит в /visual-lab/ и сам
          // достроит префикс. Абсолютный '/index.html' ломал офлайн-навигацию.
          navigateFallback: 'index.html',
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
  };
});
