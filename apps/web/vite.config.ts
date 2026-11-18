/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const API = process.env.API_ORIGIN ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Our own worker (src/sw.ts): the precache as before plus the push handler.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      manifest: {
        name: 'Gym',
        short_name: 'Gym',
        lang: 'el',
        display: 'standalone',
        start_url: '/',
        background_color: '#ffffff',
        theme_color: '#0f172a',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      injectManifest: { globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'] },
    }),
  ],
  // Load @gym/shared from TypeScript source. Vite 6+ replaces the defaults, so keep them.
  resolve: { conditions: ['source', ...defaultClientConditions] },
  server: {
    port: 5173,
    strictPort: true,
    // Lets a cloudflared quick tunnel reach the dev server for real-device checks.
    allowedHosts: ['.trycloudflare.com'],
    // Same origin in dev: the refresh cookie is SameSite=Strict. /api/auth/* reaches the API's
    // /auth/*, and the cookie path is rewritten to match what the browser requested.
    // The live check-in stream (text/event-stream) passes through unbuffered: Vite's proxy does not
    // buffer, and the API sends X-Accel-Buffering: no for production proxies.
    proxy: {
      '/api': {
        target: API,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        cookiePathRewrite: { '/auth': '/api/auth' },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.{ts,tsx}'],
    setupFiles: ['src/test-setup.ts'],
  },
});
