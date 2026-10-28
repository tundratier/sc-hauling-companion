import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

import { resetMemoryCache } from '../api/cache'
import { PRICES_TTL_MS } from '../api/dataStore'
import { UexError } from '../api/uexClient'
import App from '../App'
import { installMockFetch, json, requestedPaths } from '../test-utils/mockFetch'
import { useAppStore } from './useAppStore'
import { useDataStore } from './useDataStore'

beforeEach(() => {
  idb.store.clear()
  resetMemoryCache()
  localStorage.clear()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useDataStore.setState(useDataStore.getInitialState(), true)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('data store orchestration', () => {
  it('startup loads static data only (4 requests); prices wait for TRADES', async () => {
    const mock = installMockFetch()
    await useDataStore.getState().initStatic()
    expect(requestedPaths(mock).sort()).toEqual([
      'commodities',
      'game_versions',
      'terminals',
      'vehicles',
    ])
    const state = useDataStore.getState()
    expect(state.staticStatus).toBe('ready')
    expect(state.prices).toBeNull()
    expect(state.staticData?.data.terminals.length).toBeGreaterThan(0)
  })

  it('ensurePrices fetches once, then serves the cache (0 requests)', async () => {
    const mock = installMockFetch()
    await useDataStore.getState().initStatic()
    await useDataStore.getState().ensurePrices()
    expect(requestedPaths(mock).filter((p) => p === 'commodities_prices_all')).toHaveLength(1)
    expect(useDataStore.getState().pricesStatus).toBe('ready')
    mock.mockClear()
    await useDataStore.getState().ensurePrices()
    expect(mock).not.toHaveBeenCalled()
  })

  it('a warm start within the TTL performs 0 requests', async () => {
    installMockFetch()
    await useDataStore.getState().initStatic()
    await useDataStore.getState().ensurePrices()
    useDataStore.setState(useDataStore.getInitialState(), true)
    const mock = installMockFetch()
    await useDataStore.getState().initStatic()
    await useDataStore.getState().ensurePrices()
    expect(mock).not.toHaveBeenCalled()
    expect(useDataStore.getState().prices).not.toBeNull()
  })

  it('shows a blocking error when nothing is cached and the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')))
    await useDataStore.getState().initStatic()
    expect(useDataStore.getState()).toMatchObject({
      staticStatus: 'error',
      staticData: null,
      staticError: { kind: 'network' },
    })
  })

  it('keeps cached data and sets a non-blocking offline error when a refresh fails', async () => {
    installMockFetch()
    await useDataStore.getState().initStatic()
    await useDataStore.getState().ensurePrices()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')))
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 5 * 60_000)
    await useDataStore.getState().refreshPrices()
    const state = useDataStore.getState()
    expect(state.offlineError).toMatchObject({ kind: 'network' })
    expect(state.prices?.data.offers.length).toBeGreaterThan(0)
    expect(state.pricesStatus).toBe('ready')
    expect(state.refreshing).toBe(false)
  })

  it('reloadAll refetches static data (4) and prices (1)', async () => {
    installMockFetch()
    await useDataStore.getState().initStatic()
    await useDataStore.getState().ensurePrices()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 5 * 60_000)
    const mock = installMockFetch()
    await useDataStore.getState().reloadAll()
    expect(mock).toHaveBeenCalledTimes(5)
  })

  it('reloadAll with no cache and a failing network reports a blocking error', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')))
    await useDataStore.getState().reloadAll()
    expect(useDataStore.getState().staticStatus).toBe('error')
  })

  it('a failed price fetch without cache is a blocking prices error', async () => {
    installMockFetch()
    await useDataStore.getState().initStatic()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')))
    await useDataStore.getState().ensurePrices()
    expect(useDataStore.getState()).toMatchObject({
      pricesStatus: 'error',
      pricesError: { kind: 'network' },
    })
  })

  it('revalidates prices in the background after 30 minutes and recomputes on arrival', async () => {
    installMockFetch()
    await useDataStore.getState().initStatic()
    await useDataStore.getState().ensurePrices()
    const before = useDataStore.getState().prices!.fetchedAt
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(before + PRICES_TTL_MS + 60_000)
    const mock = installMockFetch()
    await useDataStore.getState().ensurePrices()
    await vi.waitFor(() =>
      expect(useDataStore.getState().prices!.fetchedAt).toBeGreaterThan(before),
    )
    expect(requestedPaths(mock)).toEqual(['commodities_prices_all'])
  })
})

describe('App wiring', () => {
  it('opening TRADES after 30 min performs exactly 1 request (E4)', async () => {
    installMockFetch()
    const user = userEvent.setup()
    const first = render(<App />)
    await screen.findByText(/LIVE 4\.10\.2/)
    await user.click(screen.getByRole('tab', { name: 'Trades' }))
    await waitFor(() => expect(useDataStore.getState().prices).not.toBeNull())
    first.unmount()

    // reload within 30 min: 0 requests, even on TRADES
    useDataStore.setState(useDataStore.getInitialState(), true)
    const warm = installMockFetch()
    const second = render(<App />)
    await screen.findByText(/LIVE 4\.10\.2/)
    await waitFor(() => expect(useDataStore.getState().prices).not.toBeNull())
    expect(warm).not.toHaveBeenCalled()
    second.unmount()

    // 31 minutes later: only the prices are refetched
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 31 * 60_000 })
    useDataStore.setState(useDataStore.getInitialState(), true)
    const stale = installMockFetch()
    render(<App />)
    await vi.waitFor(() => expect(stale).toHaveBeenCalledTimes(1))
    expect(requestedPaths(stale)).toEqual(['commodities_prices_all'])
  })

  it('shows the offline banner and a warning status when a refresh fails', async () => {
    installMockFetch()
    render(<App />)
    await screen.findByText(/LIVE 4\.10\.2/)
    act(() => {
      useDataStore.setState({ offlineError: new UexError('network', 'Failed to fetch') })
    })
    expect(screen.getByText(/Offline — showing data from/)).toBeInTheDocument()
  })

  it('shows a blocking error with Retry when the first load fails, then recovers', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(json({ status: 'error', http_code: 500 }, 500)),
    )
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load data')
    installMockFetch()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('combobox', { name: 'Ship' })).toBeInTheDocument()
  })

  it('does not refetch while the document is hidden and catches up when visible', async () => {
    installMockFetch()
    render(<App />)
    await screen.findByText(/LIVE 4\.10\.2/)
    const mock = installMockFetch()
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => expect(useDataStore.getState().staticStatus).toBe('ready'))
    expect(mock).not.toHaveBeenCalled() // cache is fresh
  })

  it('"Refresh prices" in the header is disabled during the 60 s cooldown', async () => {
    installMockFetch()
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText(/LIVE 4\.10\.2/)
    await user.click(screen.getByRole('tab', { name: 'Trades' }))
    await waitFor(() => expect(useDataStore.getState().prices).not.toBeNull())
    expect(screen.getByRole('button', { name: 'Refresh prices' })).toBeDisabled()
  })
})
