import { beforeEach, describe, expect, it, vi } from 'vitest'

const idb = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  broken: false,
}))

vi.mock('idb-keyval', () => ({
  get: vi.fn<(key: string) => Promise<unknown>>(async (key: string) => {
    if (idb.broken) throw new ReferenceError('indexedDB is not defined')
    return idb.store.get(key)
  }),
  set: vi.fn<(key: string, value: unknown) => Promise<void>>(
    async (key: string, value: unknown) => {
      if (idb.broken) throw new ReferenceError('indexedDB is not defined')
      idb.store.set(key, value)
    },
  ),
}))

import { cacheGet, cacheSet, isFresh, resetMemoryCache, type CacheEntry } from './cache'

const entry = (over: Partial<CacheEntry<string>> = {}): CacheEntry<string> => ({
  key: 'k',
  schemaVersion: 1,
  fetchedAt: 1_000,
  gameVersion: '4.10.2',
  data: 'payload',
  ...over,
})

beforeEach(() => {
  idb.store.clear()
  idb.broken = false
  resetMemoryCache()
})

describe('isFresh (TTL)', () => {
  it('is fresh strictly before the TTL elapses and expired from then on', () => {
    const e = entry({ fetchedAt: 1_000 })
    expect(isFresh(e, 500, 1_499)).toBe(true)
    expect(isFresh(e, 500, 1_500)).toBe(false)
    expect(isFresh(e, 500, 9_999)).toBe(false)
  })
})

describe('cacheGet / cacheSet', () => {
  it('round-trips an entry through IndexedDB', async () => {
    await cacheSet(entry())
    expect(idb.store.get('k')).toMatchObject({ data: 'payload' })
    expect(await cacheGet('k')).toMatchObject({ data: 'payload', gameVersion: '4.10.2' })
  })

  it('returns null for a missing key', async () => {
    expect(await cacheGet('missing')).toBeNull()
  })

  it('ignores entries with another schemaVersion', async () => {
    await cacheSet(entry({ schemaVersion: 1 }))
    expect(await cacheGet('k', 2)).toBeNull()
    expect(await cacheGet('k', 1)).not.toBeNull()
  })

  it('falls back to memory when IndexedDB is unavailable', async () => {
    idb.broken = true
    await expect(cacheSet(entry())).resolves.toBeUndefined()
    expect(idb.store.size).toBe(0)
    expect(await cacheGet('k')).toMatchObject({ data: 'payload' })
  })

  it('reads an entry persisted by an earlier session', async () => {
    idb.store.set('old', entry({ key: 'old', data: 'from disk' }))
    expect(await cacheGet('old')).toMatchObject({ data: 'from disk' })
  })
})
