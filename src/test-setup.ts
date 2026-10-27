import '@testing-library/jest-dom/vitest'
import { beforeEach, vi } from 'vitest'

// Tests never hit the live UEX API: any test that needs data installs its own mock fetch.
beforeEach(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Network access is disabled in tests')))
})
