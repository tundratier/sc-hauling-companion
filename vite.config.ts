/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves the app under /<repo>/; the Docker build passes it in.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  server: {
    // Windows bind mounts don't emit FS events; poll when running in Docker.
    watch: process.env.CHOKIDAR_USEPOLLING ? { usePolling: true } : undefined,
  },
  test: {
    environment: 'jsdom',
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
