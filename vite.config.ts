import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { configDefaults } from 'vitest/config'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// GitHub Pages serves the app under /<repo>/; the Docker build passes it in.
const base = process.env.BASE_PATH ?? '/'

// https://vite.dev/config/
export default defineConfig({
  base,
  define: { APP_VERSION: JSON.stringify(version) },
  plugins: [
    react(),
    // Installable PWA with an offline shell (docs/SPEC.md §5.5). Production builds only.
    VitePWA({
      strategies: 'generateSW',
      registerType: 'prompt',
      injectRegister: false,
      devOptions: { enabled: false },
      manifest: {
        name: 'SC Hauling Companion',
        short_name: 'Hauling',
        description:
          'Star Citizen cargo hauling planner — trades per stop for your ship and route.',
        // relative, so the same build works under /sc-hauling-companion/ and /
        id: './',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#0a0907',
        theme_color: '#0a0907',
        lang: 'en',
        categories: ['games', 'utilities'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // shell, bundles, icons, manifest, woff2 fonts (no woff) and the static terminal maps.
        // The UEX API is not handled here: no runtimeCaching (the IndexedDB cache owns that data).
        globPatterns: ['**/*.{html,js,css,svg,png,woff2,webmanifest}', 'terminal-map/*.json'],
        navigateFallback: `${base}index.html`,
        navigateFallbackAllowlist: [new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`)],
        cleanupOutdatedCaches: true,
        // a new version waits until the user taps RELOAD in the update banner
        skipWaiting: false,
        clientsClaim: false,
      },
    }),
  ],
  server: {
    // Windows bind mounts don't emit FS events; poll when running in Docker.
    watch: process.env.CHOKIDAR_USEPOLLING ? { usePolling: true } : undefined,
  },
  test: {
    environment: 'jsdom',
    // other sessions keep git worktrees (with their own copy of src/) under .claude/
    exclude: [...configDefaults.exclude, '.claude/**'],
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/calc/**', 'src/api/mappers.ts'],
      exclude: ['src/calc/**/*.test.ts'],
      thresholds: { lines: 90 },
    },
  },
})
