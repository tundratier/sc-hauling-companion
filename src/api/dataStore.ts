import type { Commodity, GameVersions, PriceOffer, Terminal, Vehicle } from '../domain/types'
import { SCHEMA_VERSION, cacheGet, cacheSet, isFresh, type CacheEntry } from './cache'
import { mapCommodities, mapGameVersions, mapPrices, mapTerminals, mapVehicles } from './mappers'
import {
  UexError,
  fetchCommodities,
  fetchGameVersions,
  fetchPricesAll,
  fetchTerminals,
  fetchVehicles,
} from './uexClient'

export const STATIC_KEY = `static:v${SCHEMA_VERSION}`
export const PRICES_KEY = `prices:v${SCHEMA_VERSION}`
export const STATIC_TTL_MS = 24 * 60 * 60 * 1000
export const PRICES_TTL_MS = 30 * 60 * 1000
export const PRICES_REFRESH_COOLDOWN_MS = 60 * 1000

export interface StaticData {
  commodities: Commodity[]
  terminals: Terminal[]
  /** Only vehicles with cargo capacity (scu > 0). */
  vehicles: Vehicle[]
  gameVersions: GameVersions
}

export interface PriceData {
  offers: PriceOffer[]
}

export interface Loaded<T> {
  data: T
  /** Milliseconds since epoch of the last successful fetch. */
  fetchedAt: number
  gameVersion: string | null
  /** Cached data past its TTL (a refresh is running, was skipped, or failed). */
  stale: boolean
  /** Set when a refresh failed and cached data is shown instead (offline banner). */
  error: UexError | null
}

export type BackgroundOutcome<T> = { ok: true; loaded: Loaded<T> } | { ok: false; error: UexError }

export interface LoadOptions<T> {
  /** User asked for a refresh: ignore TTL and wait for the network. */
  force?: boolean
  /** Called when a background revalidation (stale-while-revalidate) settles. */
  onBackground?: (outcome: BackgroundOutcome<T>) => void
  signal?: AbortSignal
}

export interface PriceLoadOptions extends LoadOptions<PriceData> {
  /** Current LIVE game version; cached prices of another version count as expired. */
  gameVersion?: string | null
}

interface DatasetConfig<T> {
  key: string
  ttlMs: number
  cooldownMs?: number
  /** Extra validity check besides the TTL (e.g. game version). */
  isCurrent?: (entry: CacheEntry<T>) => boolean
  fetchFresh: (signal?: AbortSignal) => Promise<{ data: T; gameVersion: string | null }>
}

const inflight = new Map<string, Promise<unknown>>()

const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

function asUexError(e: unknown): UexError {
  return e instanceof UexError
    ? e
    : new UexError('network', e instanceof Error ? e.message : 'Error')
}

function toLoaded<T>(entry: CacheEntry<T>, stale: boolean, error: UexError | null): Loaded<T> {
  return {
    data: entry.data,
    fetchedAt: entry.fetchedAt,
    gameVersion: entry.gameVersion,
    stale,
    error,
  }
}

function refresh<T>(cfg: DatasetConfig<T>, signal?: AbortSignal): Promise<Loaded<T>> {
  const existing = inflight.get(cfg.key) as Promise<Loaded<T>> | undefined
  if (existing) return existing
  const promise = (async () => {
    try {
      const { data, gameVersion } = await cfg.fetchFresh(signal)
      const entry: CacheEntry<T> = {
        key: cfg.key,
        schemaVersion: SCHEMA_VERSION,
        fetchedAt: Date.now(),
        gameVersion,
        data,
      }
      await cacheSet(entry)
      return toLoaded(entry, false, null)
    } finally {
      inflight.delete(cfg.key)
    }
  })()
  inflight.set(cfg.key, promise)
  return promise
}

async function loadDataset<T>(cfg: DatasetConfig<T>, opts: LoadOptions<T>): Promise<Loaded<T>> {
  const cached = await cacheGet<T>(cfg.key)
  const now = Date.now()

  if (cached) {
    const fresh = isFresh(cached, cfg.ttlMs, now) && (cfg.isCurrent?.(cached) ?? true)
    if (!opts.force) {
      if (fresh) return toLoaded(cached, false, null)
      // Stale-while-revalidate: render cached data now, refetch in the background —
      // but never while the tab is hidden (the caller retries when it becomes visible).
      if (!isHidden()) {
        refresh(cfg).then(
          (loaded) => opts.onBackground?.({ ok: true, loaded }),
          (e) => opts.onBackground?.({ ok: false, error: asUexError(e) }),
        )
      }
      return toLoaded(cached, true, null)
    }
    if (cfg.cooldownMs && now - cached.fetchedAt < cfg.cooldownMs) {
      return toLoaded(cached, !fresh, null)
    }
  }

  try {
    return await refresh(cfg, opts.signal)
  } catch (e) {
    if (cached) return toLoaded(cached, true, asUexError(e))
    throw asUexError(e)
  }
}

async function fetchStatic(signal?: AbortSignal) {
  const [commodities, terminals, vehicles, versions] = await Promise.all([
    fetchCommodities(signal),
    fetchTerminals(signal),
    fetchVehicles(signal),
    fetchGameVersions(signal),
  ])
  const gameVersions = mapGameVersions(versions)
  const data: StaticData = {
    commodities: mapCommodities(commodities),
    terminals: mapTerminals(terminals),
    vehicles: mapVehicles(vehicles).filter((v) => v.scu > 0),
    gameVersions,
  }
  return { data, gameVersion: gameVersions.live || null }
}

/** Commodities, terminals, vehicles and game version: one entry, 4 requests, 24 h TTL. */
export function loadStaticData(opts: LoadOptions<StaticData> = {}): Promise<Loaded<StaticData>> {
  return loadDataset<StaticData>(
    { key: STATIC_KEY, ttlMs: STATIC_TTL_MS, fetchFresh: fetchStatic },
    opts,
  )
}

/**
 * All current buy/sell prices: 1 request, 30 min TTL. Call this when TRADES is opened or
 * recomputed — never on startup. A manual refresh within 60 s of the last fetch is a no-op.
 */
export function loadPrices(opts: PriceLoadOptions = {}): Promise<Loaded<PriceData>> {
  const gameVersion = opts.gameVersion ?? null
  return loadDataset<PriceData>(
    {
      key: PRICES_KEY,
      ttlMs: PRICES_TTL_MS,
      cooldownMs: PRICES_REFRESH_COOLDOWN_MS,
      isCurrent: (entry) => gameVersion === null || entry.gameVersion === gameVersion,
      fetchFresh: async (signal) => ({
        data: { offers: mapPrices(await fetchPricesAll(signal)) },
        gameVersion,
      }),
    },
    opts,
  )
}

/** Cached data without any network access (null if nothing cached). */
export async function peekStatic(): Promise<Loaded<StaticData> | null> {
  const entry = await cacheGet<StaticData>(STATIC_KEY)
  return entry ? toLoaded(entry, !isFresh(entry, STATIC_TTL_MS), null) : null
}

export async function peekPrices(): Promise<Loaded<PriceData> | null> {
  const entry = await cacheGet<PriceData>(PRICES_KEY)
  return entry ? toLoaded(entry, !isFresh(entry, PRICES_TTL_MS), null) : null
}

/** Milliseconds until a manual price refresh is allowed again (0 = allowed now). */
export function refreshCooldownRemainingMs(fetchedAt: number, now: number = Date.now()): number {
  return Math.max(0, PRICES_REFRESH_COOLDOWN_MS - (now - fetchedAt))
}
