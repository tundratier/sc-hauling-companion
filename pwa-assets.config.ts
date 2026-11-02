import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Icons for the PWA manifest and iOS, generated from the favicon:
//   docker compose run --rm dev npm run generate-pwa-assets
const background = '#0a0907'

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    // the favicon stays the SVG; no extra favicon.ico
    transparent: { ...minimal2023Preset.transparent, favicons: [] },
    // padded icons sit on the app's background colour, the triangle well inside the safe zone
    maskable: { ...minimal2023Preset.maskable, padding: 0.2, resizeOptions: { background } },
    apple: { ...minimal2023Preset.apple, padding: 0.15, resizeOptions: { background } },
  },
  images: ['public/favicon.svg'],
})
