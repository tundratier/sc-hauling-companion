import { get, set } from 'idb-keyval'

export const SCHEMA_VERSION = 1

export interface CacheEntry<T> {
  key: string
  schemaVersion: number
  /** Milliseconds since epoch. */
  fetchedAt: number
  gameVersion: string | null
  data: T
}

/** In-memory mirror; also the only store when IndexedDB is unavailable (private mode). */
const memory = new Map<string, CacheEntry<unknown>>()

export function resetMemoryCache(): void {
  memory.clear()
}

export async function cacheGet<T>(
  key: string,
  schemaVersion: number = SCHEMA_VERSION,
): Promise<CacheEntry<T> | null> {
  let entry: CacheEntry<T> | undefined
  try {
    entry = await get<CacheEntry<T>>(key)
  } catch {
    // IndexedDB unavailable — fall through to memory.
  }
  entry ??= memory.get(key) as CacheEntry<T> | undefined
  if (!entry || entry.schemaVersion !== schemaVersion) return null
  return entry
}

export async function cacheSet<T>(entry: CacheEntry<T>): Promise<void> {
  memory.set(entry.key, entry)
  try {
    await set(entry.key, entry)
  } catch {
    // Keep working from memory.
  }
}

export function isFresh(entry: CacheEntry<unknown>, ttlMs: number, now: number = Date.now()) {
  return now - entry.fetchedAt < ttlMs
}
