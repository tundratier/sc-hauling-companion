import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const idb = vi.hoisted(() => ({ store: new Map<string, unknown>() }))

vi.mock('idb-keyval', () => ({
  get: vi.fn<(key: string) => Promise<unknown>>(async (key: string) => idb.store.get(key)),
  set: vi.fn<(key: string, value: unknown) => Promise<void>>(
    async (key: string, value: unknown) => {
      idb.store.set(key, value)
    },
  ),
}))

import { installMockFetch, json, requestedPaths } from '../test-utils/mockFetch'
import { resetMemoryCache } from './cache'
import {
  PRICES_KEY,
  PRICES_REFRESH_COOLDOWN_MS,
  PRICES_TTL_MS,
  STATIC_KEY,
  STATIC_TTL_MS,
  loadPrices,
  loadStaticData,
  peekPrices,
  peekStatic,
  refreshCooldownRemainingMs,
  type BackgroundOutcome,
  type PriceData,
  type StaticData,
} from './dataStore'

const MIN = 60 * 1000
const START = new Date('2026-10-27T12:00:00Z').getTime()

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  })
}

beforeEach(() => {
  idb.store.clear()
  resetMemoryCache()
  setHidden(false)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(START)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const advance = (ms: number) => vi.setSystemTime(Date.now() + ms)

describe('cold start', () => {
  it('performs 5 requests (E1–E3, E5 static + E4 prices) and caches mapped data', async () => {
    const mock = installMockFetch()
    const staticData = await loadStaticData()
    const prices = await loadPrices({ gameVersion: staticData.gameVersion })

    expect(requestedPaths(mock).sort()).toEqual(
      ['commodities', 'commodities_prices_all', 'game_versions', 'terminals', 'vehicles'].sort(),
    )
    expect(staticData.stale).toBe(false)
    expect(staticData.gameVersion).toBe('4.10.2')
    expect(staticData.data.gameVersions).toEqual({ live: '4.10.2', ptu: '4.10.3' })
    expect(staticData.data.commodities.length).toBeGreaterThan(0)
    expect(staticData.data.terminals).toHaveLength(8)
    // only vehicles with cargo capacity are stored
    expect(staticData.data.vehicles.every((v) => v.scu > 0)).toBe(true)
    expect(staticData.data.vehicles.some((v) => v.name === 'Gladius')).toBe(false)
    expect(prices.data.offers).toHaveLength(3)
    expect(idb.store.has(STATIC_KEY)).toBe(true)
    expect(idb.store.has(PRICES_KEY)).toBe(true)
  })

  it('only loads static data on startup — prices are not requested until asked for', async () => {
    const mock = installMockFetch()
    await loadStaticData()
    expect(requestedPaths(mock)).not.toContain('commodities_prices_all')
    expect(mock).toHaveBeenCalledTimes(4)
  })
})

describe('static cache schema (terminals gained idSpaceStation / idCity)', () => {
  const oldEntry = (schemaVersion: number) => ({
    key: STATIC_KEY,
    schemaVersion,
    fetchedAt: Date.now(),
    gameVersion: '4.10.2',
    data: {
      commodities: [],
      terminals: [],
      vehicles: [],
      gameVersions: { live: '4.10.2', ptu: '' },
    },
  })

  it('refetches static data cached in the old shape, once', async () => {
    idb.store.set(STATIC_KEY, oldEntry(1))
    const mock = installMockFetch()
    const loaded = await loadStaticData()
    expect(mock).toHaveBeenCalledTimes(4)
    expect(loaded.data.terminals[0]).toHaveProperty('idSpaceStation')
    // the next load is served from the new entry
    const again = installMockFetch()
    await loadStaticData()
    expect(again).not.toHaveBeenCalled()
  })

  it('keeps using static data cached in the current shape, and never refetches prices for it', async () => {
    idb.store.set(STATIC_KEY, oldEntry(2))
    const mock = installMockFetch()
    await loadStaticData()
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('warm start within TTL', () => {
  it('performs 0 requests', async () => {
    const first = installMockFetch()
    const s = await loadStaticData()
    await loadPrices({ gameVersion: s.gameVersion })
    expect(first).toHaveBeenCalledTimes(5)

    advance(20 * MIN)
    const second = installMockFetch()
    const s2 = await loadStaticData()
    const p2 = await loadPrices({ gameVersion: s2.gameVersion })
    expect(second).not.toHaveBeenCalled()
    expect(s2.stale).toBe(false)
    expect(p2.stale).toBe(false)
  })

  it('static data stays fresh for 24 h and is then refetched (4 requests)', async () => {
    installMockFetch()
    await loadStaticData()
    advance(STATIC_TTL_MS - MIN)
    const mock = installMockFetch()
    expect((await loadStaticData()).stale).toBe(false)
    expect(mock).not.toHaveBeenCalled()

    advance(2 * MIN)
    const onBackground = vi.fn<(o: BackgroundOutcome<StaticData>) => void>()
    const loaded = await loadStaticData({ onBackground })
    expect(loaded.stale).toBe(true)
    await vi.waitFor(() => expect(onBackground).toHaveBeenCalled())
    expect(mock).toHaveBeenCalledTimes(4)
  })
})

describe('prices after 30 minutes (stale-while-revalidate)', () => {
  it('returns the cached prices immediately and revalidates with exactly 1 request (E4)', async () => {
    installMockFetch()
    const s = await loadStaticData()
    await loadPrices({ gameVersion: s.gameVersion })

    advance(PRICES_TTL_MS + MIN)
    const mock = installMockFetch()
    const outcomes: BackgroundOutcome<PriceData>[] = []
    const loaded = await loadPrices({
      gameVersion: s.gameVersion,
      onBackground: (o) => outcomes.push(o),
    })

    expect(loaded.stale).toBe(true)
    expect(loaded.data.offers).toHaveLength(3)
    await vi.waitFor(() => expect(outcomes).toHaveLength(1))
    expect(requestedPaths(mock)).toEqual(['commodities_prices_all'])
    const outcome = outcomes[0]
    expect(outcome.ok && outcome.loaded.stale).toBe(false)
    expect(outcome.ok && outcome.loaded.fetchedAt).toBeGreaterThan(START + PRICES_TTL_MS)
  })

  it('does not revalidate while the tab is hidden', async () => {
    installMockFetch()
    await loadPrices()
    advance(PRICES_TTL_MS + MIN)
    setHidden(true)
    const mock = installMockFetch()
    const loaded = await loadPrices()
    expect(loaded.stale).toBe(true)
    expect(mock).not.toHaveBeenCalled()
  })

  it('background failure is reported via onBackground, cached data is still returned', async () => {
    installMockFetch()
    await loadPrices()
    advance(PRICES_TTL_MS + MIN)
    installMockFetch(() => json({ status: 'error', http_code: 500, message: 'down' }, 500))
    const onBackground = vi.fn<(o: BackgroundOutcome<PriceData>) => void>()
    const loaded = await loadPrices({ onBackground })
    expect(loaded.stale).toBe(true)
    await vi.waitFor(() => expect(onBackground).toHaveBeenCalled())
    expect(onBackground.mock.calls[0][0]).toMatchObject({ ok: false, error: { kind: 'http' } })
  })
})

describe('game version invalidation', () => {
  it('treats prices cached under another game version as expired', async () => {
    installMockFetch()
    await loadPrices({ gameVersion: '4.10.2' })

    advance(MIN) // well within the TTL
    const mock = installMockFetch()
    const onBackground = vi.fn<(o: BackgroundOutcome<PriceData>) => void>()
    const loaded = await loadPrices({ gameVersion: '4.10.3', onBackground })
    expect(loaded.stale).toBe(true)
    await vi.waitFor(() => expect(onBackground).toHaveBeenCalled())
    expect(requestedPaths(mock)).toEqual(['commodities_prices_all'])
    const outcome = onBackground.mock.calls[0][0]
    expect(outcome.ok && outcome.loaded.gameVersion).toBe('4.10.3')
  })

  it('same game version within the TTL stays cached', async () => {
    installMockFetch()
    await loadPrices({ gameVersion: '4.10.2' })
    const mock = installMockFetch()
    await loadPrices({ gameVersion: '4.10.2' })
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('manual refresh', () => {
  it('is a no-op within 60 s of the last fetch, allowed afterwards', async () => {
    installMockFetch()
    await loadPrices()

    advance(PRICES_REFRESH_COOLDOWN_MS - 1000)
    const mock = installMockFetch()
    const cooled = await loadPrices({ force: true })
    expect(mock).not.toHaveBeenCalled()
    expect(cooled.stale).toBe(false)

    advance(2000)
    const refreshed = await loadPrices({ force: true })
    expect(mock).toHaveBeenCalledTimes(1)
    expect(refreshed.fetchedAt).toBe(Date.now())
  })

  it('"Reload all data" refetches static data regardless of TTL', async () => {
    installMockFetch()
    await loadStaticData()
    const mock = installMockFetch()
    await loadStaticData({ force: true })
    expect(mock).toHaveBeenCalledTimes(4)
  })

  it('computes the remaining cooldown', () => {
    expect(refreshCooldownRemainingMs(START, START + 10_000)).toBe(50_000)
    expect(refreshCooldownRemainingMs(START, START + 90_000)).toBe(0)
  })
})

describe('errors', () => {
  it('keeps using cached data and reports the error when a forced refresh fails', async () => {
    installMockFetch()
    await loadPrices()
    advance(5 * MIN)
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')))
    const loaded = await loadPrices({ force: true })
    expect(loaded.error).toMatchObject({ kind: 'network' })
    expect(loaded.data.offers).toHaveLength(3)
    expect(loaded.fetchedAt).toBe(START)
    expect(loaded.stale).toBe(true)
  })

  it('throws (blocking error) when there is no cache at all', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')))
    await expect(loadStaticData()).rejects.toMatchObject({ name: 'UexError', kind: 'network' })
  })

  it('surfaces a failed static request without caching a partial result', async () => {
    installMockFetch((url) => (url.pathname === '/2.0/vehicles' ? json({}, 503) : undefined))
    await expect(loadStaticData()).rejects.toMatchObject({ kind: 'http', httpCode: 503 })
    expect(idb.store.has(STATIC_KEY)).toBe(false)
  })

  it('does not hit the API again after a failure once cached', async () => {
    installMockFetch()
    await loadStaticData()
    const mock = installMockFetch(() => json({}, 500))
    await loadStaticData()
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('in-flight requests', () => {
  it('shares one request between concurrent callers', async () => {
    const mock = installMockFetch()
    const [a, b] = await Promise.all([loadPrices(), loadPrices()])
    expect(requestedPaths(mock)).toEqual(['commodities_prices_all'])
    expect(a.fetchedAt).toBe(b.fetchedAt)
  })
})

describe('works without IndexedDB', () => {
  it('falls back to the in-memory cache', async () => {
    const idbModule = await import('idb-keyval')
    vi.mocked(idbModule.get).mockRejectedValue(new ReferenceError('indexedDB is not defined'))
    vi.mocked(idbModule.set).mockRejectedValue(new ReferenceError('indexedDB is not defined'))
    const mock = installMockFetch()
    await loadStaticData()
    await loadStaticData()
    expect(mock).toHaveBeenCalledTimes(4)
  })
})

describe('peek', () => {
  it('returns null when nothing is cached and the cached data without network otherwise', async () => {
    const mock = installMockFetch()
    expect(await peekPrices()).toBeNull()
    expect(await peekStatic()).toBeNull()
    await loadStaticData()
    await loadPrices()
    advance(PRICES_TTL_MS + MIN)
    mock.mockClear()
    expect(await peekPrices()).toMatchObject({ stale: true })
    expect(await peekStatic()).toMatchObject({ stale: false })
    expect(mock).not.toHaveBeenCalled()
  })
})
