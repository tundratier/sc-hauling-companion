import { beforeEach, describe, expect, it, vi } from 'vitest'

const idb = vi.hoisted(() => ({ store: new Map<string, unknown>() }))
vi.mock('idb-keyval', () => ({
  get: vi.fn<(key: string) => Promise<unknown>>(async (key: string) => idb.store.get(key)),
  set: vi.fn<(key: string, value: unknown) => Promise<void>>(
    async (key: string, value: unknown) => {
      idb.store.set(key, value)
    },
  ),
}))

import { json, urlOf } from '../test-utils/mockFetch'
import { testMap } from '../test-utils/mapFixture'
import { resetMemoryCache } from './cache'
import {
  MapLoadError,
  compareGameVersions,
  loadTerminalMap,
  pickMapVersion,
  resetMapMemory,
} from './terminalMap'

const mapFile = (version: string) => ({
  ...testMap([
    { id: 'station:A', x: 0, terminals: [1] },
    { id: 'station:B', x: 10, terminals: [2] },
  ]),
  gameVersion: version,
})

interface Served {
  versions: string[]
  indexSchema?: number
  fileOverride?: (version: string) => unknown
}

function serve(opts: Served) {
  const requested: string[] = []
  const mock = vi.fn<typeof fetch>(async (input) => {
    const url = urlOf(input)
    requested.push(url)
    if (url.endsWith('terminal-map/index.json')) {
      return json({ schemaVersion: opts.indexSchema ?? 2, versions: opts.versions })
    }
    const match = /terminal-map\/(.+)\.json$/.exec(url)
    const version = match?.[1]
    if (version && opts.versions.includes(version)) {
      return json(opts.fileOverride ? opts.fileOverride(version) : mapFile(version))
    }
    return json({ message: 'missing' }, 404)
  })
  vi.stubGlobal('fetch', mock)
  return { mock, requested }
}

beforeEach(() => {
  idb.store.clear()
  resetMemoryCache()
  resetMapMemory()
  vi.unstubAllGlobals()
})

describe('version helpers', () => {
  it('compares dotted game versions numerically', () => {
    expect(compareGameVersions('4.9.0', '4.10.2')).toBeLessThan(0)
    expect(compareGameVersions('4.10.2', '4.10.2')).toBe(0)
    expect(compareGameVersions('4.10.3', '4.10.2')).toBeGreaterThan(0)
    expect(compareGameVersions('4.10', '4.10.0')).toBe(0)
  })

  it('picks the LIVE file, else the newest older one', () => {
    const versions = ['4.9.0', '4.10.2', '4.11.0']
    expect(pickMapVersion(versions, '4.10.2')).toBe('4.10.2')
    expect(pickMapVersion(versions, '4.10.5')).toBe('4.10.2')
    expect(pickMapVersion(versions, '4.8.0')).toBeNull()
    expect(pickMapVersion(versions, null)).toBe('4.11.0')
    expect(pickMapVersion([], '4.10.2')).toBeNull()
  })
})

describe('loadTerminalMap', () => {
  it('fetches the index and the file for the LIVE version from the app (no UEX request)', async () => {
    const { requested } = serve({ versions: ['4.10.2'] })
    const loaded = await loadTerminalMap('4.10.2')
    expect(loaded).toMatchObject({ fileVersion: '4.10.2', liveVersion: '4.10.2', older: false })
    expect(loaded.data.nodes).toHaveLength(2)
    expect(requested).toEqual(['/terminal-map/index.json', '/terminal-map/4.10.2.json'])
    expect(requested.some((u) => u.includes('uexcorp'))).toBe(false)
  })

  it('fetches at most once per game version: memory, then IndexedDB', async () => {
    const { mock } = serve({ versions: ['4.10.2'] })
    await loadTerminalMap('4.10.2')
    await loadTerminalMap('4.10.2')
    expect(mock).toHaveBeenCalledTimes(2) // index + file, once
    expect(idb.store.has('map:v2:4.10.2')).toBe(true)
    resetMapMemory() // a new page load
    const reloaded = await loadTerminalMap('4.10.2')
    expect(mock).toHaveBeenCalledTimes(2)
    expect(reloaded.fileVersion).toBe('4.10.2')
  })

  it('shares one request between concurrent callers', async () => {
    const { mock } = serve({ versions: ['4.10.2'] })
    await Promise.all([loadTerminalMap('4.10.2'), loadTerminalMap('4.10.2')])
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('falls back to the newest older map and says so', async () => {
    serve({ versions: ['4.9.0', '4.10.2'] })
    const loaded = await loadTerminalMap('4.11.0')
    expect(loaded).toMatchObject({ fileVersion: '4.10.2', liveVersion: '4.11.0', older: true })
    // cached for the new LIVE version without TTL
    expect(idb.store.has('map:v2:4.11.0')).toBe(true)
  })

  it('loads the new file when the LIVE version changes', async () => {
    const { requested } = serve({ versions: ['4.10.2', '4.11.0'] })
    await loadTerminalMap('4.10.2')
    const next = await loadTerminalMap('4.11.0')
    expect(next.fileVersion).toBe('4.11.0')
    expect(requested.filter((u) => u.endsWith('.json') && !u.includes('index'))).toEqual([
      '/terminal-map/4.10.2.json',
      '/terminal-map/4.11.0.json',
    ])
  })

  it('works without a known LIVE version (newest map)', async () => {
    serve({ versions: ['4.9.0', '4.10.2'] })
    expect((await loadTerminalMap(null)).fileVersion).toBe('4.10.2')
  })

  it('rejects when no map is old enough', async () => {
    serve({ versions: ['4.10.2'] })
    await expect(loadTerminalMap('4.8.0')).rejects.toBeInstanceOf(MapLoadError)
  })

  it('rejects an index or file with another schemaVersion', async () => {
    serve({ versions: ['4.10.2'], indexSchema: 1 })
    await expect(loadTerminalMap('4.10.2')).rejects.toThrow(/index/)
    resetMapMemory()
    serve({ versions: ['4.10.2'], fileOverride: (v) => ({ ...mapFile(v), schemaVersion: 1 }) })
    await expect(loadTerminalMap('4.10.2')).rejects.toThrow(/unsupported format/)
    expect(idb.store.size).toBe(0)
  })

  it('rejects a file whose travel table does not match its nodes', async () => {
    serve({ versions: ['4.10.2'], fileOverride: (v) => ({ ...mapFile(v), travel: [0] }) })
    await expect(loadTerminalMap('4.10.2')).rejects.toBeInstanceOf(MapLoadError)
  })

  it('reports network and HTTP errors without caching them', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')))
    await expect(loadTerminalMap('4.10.2')).rejects.toThrow(/network/)
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => json({}, 404)),
    )
    await expect(loadTerminalMap('4.10.2')).rejects.toThrow(/HTTP 404/)
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response('nope')),
    )
    await expect(loadTerminalMap('4.10.2')).rejects.toThrow(/not valid JSON/)
    expect(idb.store.size).toBe(0)
    // and a later success is possible
    serve({ versions: ['4.10.2'] })
    await expect(loadTerminalMap('4.10.2')).resolves.toBeDefined()
  })
})
