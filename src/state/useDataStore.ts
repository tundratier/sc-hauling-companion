import { create } from 'zustand'
import {
  loadPrices,
  loadStaticData,
  peekPrices,
  peekStatic,
  type BackgroundOutcome,
  type Loaded,
  type PriceData,
  type StaticData,
} from '../api/dataStore'
import { UexError } from '../api/uexClient'

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

/** In-memory view of the cached/fetched datasets (not persisted — IndexedDB does that). */
export interface DataState {
  staticData: Loaded<StaticData> | null
  prices: Loaded<PriceData> | null
  staticStatus: LoadStatus
  pricesStatus: LoadStatus
  /** Blocking errors: nothing cached to fall back to. */
  staticError: UexError | null
  pricesError: UexError | null
  /** Non-blocking: a refresh failed, cached data is shown ("Offline — showing data from …"). */
  offlineError: UexError | null
  /** A manual refresh is running. */
  refreshing: boolean

  /** Startup: show cached static data immediately, revalidate in the background. */
  initStatic: () => Promise<void>
  /** Called when TRADES is opened/recomputed — fetches prices only if missing or expired. */
  ensurePrices: () => Promise<void>
  /** "Refresh prices" (rate limited to once per 60 s inside the data layer). */
  refreshPrices: () => Promise<void>
  /** "Reload all data": static data and prices. */
  reloadAll: () => Promise<void>
}

const asUexError = (e: unknown) =>
  e instanceof UexError ? e : new UexError('network', e instanceof Error ? e.message : 'Error')

export const useDataStore = create<DataState>()((set, get) => {
  const gameVersion = () => get().staticData?.gameVersion ?? null

  const applyStatic = (loaded: Loaded<StaticData>) => {
    const previous = get().staticData?.gameVersion
    set({
      staticData: loaded,
      staticStatus: 'ready',
      staticError: null,
      offlineError: loaded.error,
    })
    // A new LIVE version makes cached prices obsolete: revalidate them if they are in use.
    if (previous && loaded.gameVersion && previous !== loaded.gameVersion && get().prices) {
      void get().ensurePrices()
    }
  }

  const applyPrices = (loaded: Loaded<PriceData>) =>
    set({
      prices: loaded,
      pricesStatus: 'ready',
      pricesError: null,
      offlineError: loaded.error ?? null,
    })

  const onStaticBackground = (outcome: BackgroundOutcome<StaticData>) => {
    if (outcome.ok) applyStatic(outcome.loaded)
    else set({ offlineError: outcome.error })
  }
  const onPricesBackground = (outcome: BackgroundOutcome<PriceData>) => {
    if (outcome.ok) applyPrices(outcome.loaded)
    else set({ offlineError: outcome.error })
  }

  return {
    staticData: null,
    prices: null,
    staticStatus: 'idle',
    pricesStatus: 'idle',
    staticError: null,
    pricesError: null,
    offlineError: null,
    refreshing: false,

    async initStatic() {
      set({ staticStatus: 'loading', staticError: null })
      try {
        // Cached data first (no network), prices only for the header pill.
        const [cached, cachedPrices] = await Promise.all([peekStatic(), peekPrices()])
        if (cachedPrices && !get().prices) set({ prices: cachedPrices, pricesStatus: 'ready' })
        if (cached && !get().staticData) set({ staticData: cached, staticStatus: 'ready' })
        applyStatic(await loadStaticData({ onBackground: onStaticBackground }))
      } catch (e) {
        set({ staticStatus: 'error', staticError: asUexError(e) })
      }
    },

    async ensurePrices() {
      if (get().pricesStatus !== 'ready') set({ pricesStatus: 'loading', pricesError: null })
      try {
        applyPrices(
          await loadPrices({ gameVersion: gameVersion(), onBackground: onPricesBackground }),
        )
      } catch (e) {
        set({ pricesStatus: 'error', pricesError: asUexError(e) })
      }
    },

    async refreshPrices() {
      set({ refreshing: true })
      try {
        applyPrices(await loadPrices({ force: true, gameVersion: gameVersion() }))
      } catch (e) {
        set({ pricesStatus: 'error', pricesError: asUexError(e) })
      } finally {
        set({ refreshing: false })
      }
    },

    async reloadAll() {
      set({ refreshing: true })
      try {
        applyStatic(await loadStaticData({ force: true }))
        applyPrices(await loadPrices({ force: true, gameVersion: gameVersion() }))
      } catch (e) {
        const error = asUexError(e)
        if (get().staticData) set({ offlineError: error })
        else set({ staticStatus: 'error', staticError: error })
      } finally {
        set({ refreshing: false })
      }
    },
  }
})
