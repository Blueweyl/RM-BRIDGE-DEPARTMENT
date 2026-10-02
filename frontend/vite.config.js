import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Relative base so the built site works from any folder or static host (e.g. GitHub Pages).
// __DEMO__ is a build-time constant: the demo (pretend office, sample crews) is only compiled into
// `npm run dev` and `npm run build:demo`. The production build (`npm run build`) does not contain it.
export default defineConfig(({ command, mode }) => ({
  base: './',
  define: { __DEMO__: JSON.stringify(command === 'serve' || mode === 'demo') },
  plugins: [
    react(),
    // Installable app with every file cached, so it opens with no signal.
    // Calls to the Google backend are never cached.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.png', 'icon-192.png', 'savvice-logo.png'],
      manifest: {
        name: 'Bridge NLEX Daily Report',
        short_name: 'NLEX Report',
        description: 'Savvice NLEX bridge maintenance — daily attendance, activity and photo reports.',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#0F2540',
        theme_color: '#0F2540',
        icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,woff2}'],
        // Only the Latin font files are needed for English/Filipino text.
        globIgnores: ['**/*-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}-*'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // Reload pages that still show an older version once the new one is installed (public/sw-reload.js).
        importScripts: ['sw-reload.js'],
      },
    }),
  ],
}));
