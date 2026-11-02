import '@testing-library/jest-dom/vitest'
import { beforeEach, vi } from 'vitest'

// Tests never hit the live UEX API: any test that needs data installs its own mock fetch.
beforeEach(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Network access is disabled in tests')))
})

// The service worker module only exists in production builds: no waiting version by default.
// UpdateBanner tests replace it with their own mock.
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  }),
}))
