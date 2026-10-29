import type { TerminalMapData, TerminalMapIndex } from '../domain/terminalMap'
import { SCHEMA_VERSION, cacheGet, cacheSet } from './cache'

/** The terminal map file format this app reads (`public/terminal-map`, SPEC §5.4). */
export const MAP_SCHEMA_VERSION = 2

export class MapLoadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MapLoadError'
  }
}

export interface LoadedMap {
  data: TerminalMapData
  /** Game version of the file that was loaded (may be older than LIVE). */
  fileVersion: string
  /** The LIVE game version it was requested for. */
  liveVersion: string
  /** The file is older than LIVE ("map from 4.10.2"). */
  older: boolean
}

interface CachedMap {
  data: TerminalMapData
  fileVersion: string
}

const mapKey = (liveVersion: string) => `map:v${MAP_SCHEMA_VERSION}:${liveVersion}`

/** Compare dotted game versions numerically (4.9.0 < 4.10.2). */
export function compareGameVersions(a: string, b: string): number {
  const pa = a.split('.').map((p) => Number.parseInt(p, 10) || 0)
  const pb = b.split('.').map((p) => Number.parseInt(p, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * The file for the LIVE version, else the newest older one. `null` when the index lists
 * nothing that is not newer than LIVE.
 */
export function pickMapVersion(versions: string[], liveVersion: string | null): string | null {
  const sorted = [...versions].sort(compareGameVersions)
  if (liveVersion === null) return sorted.at(-1) ?? null
  const notNewer = sorted.filter((v) => compareGameVersions(v, liveVersion) <= 0)
  return notNewer.at(-1) ?? null
}

const inflight = new Map<string, Promise<LoadedMap>>()
const memory = new Map<string, LoadedMap>()

/** Test helper: forget what was loaded in this session. */
export function resetMapMemory(): void {
  inflight.clear()
  memory.clear()
}

async function fetchJson(url: string): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url)
  } catch {
    throw new MapLoadError('Could not load the terminal map (network error).')
  }
  if (!response.ok)
    throw new MapLoadError(`Could not load the terminal map (HTTP ${response.status}).`)
  try {
    return await response.json()
  } catch {
    throw new MapLoadError('The terminal map is not valid JSON.')
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function parseIndex(raw: unknown): TerminalMapIndex {
  if (!isRecord(raw) || raw.schemaVersion !== MAP_SCHEMA_VERSION || !Array.isArray(raw.versions)) {
    throw new MapLoadError('The terminal map index has an unsupported format.')
  }
  return {
    schemaVersion: MAP_SCHEMA_VERSION,
    versions: raw.versions.filter((v): v is string => typeof v === 'string'),
  }
}

function parseMap(raw: unknown): TerminalMapData {
  if (
    !isRecord(raw) ||
    raw.schemaVersion !== MAP_SCHEMA_VERSION ||
    !Array.isArray(raw.nodes) ||
    !Array.isArray(raw.travel) ||
    !isRecord(raw.terminalNode) ||
    raw.travel.length !== raw.nodes.length ** 2
  ) {
    throw new MapLoadError('The terminal map file has an unsupported format.')
  }
  // the file was written by tools/terminal-map and checked above; its shape is TerminalMapData
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return raw as unknown as TerminalMapData
}

async function load(liveVersion: string | null): Promise<LoadedMap> {
  const base = `${import.meta.env.BASE_URL}terminal-map/`
  const index = parseIndex(await fetchJson(`${base}index.json`))
  const fileVersion = pickMapVersion(index.versions, liveVersion)
  if (fileVersion === null)
    throw new MapLoadError('No terminal map is available for this game version.')
  const data = parseMap(await fetchJson(`${base}${fileVersion}.json`))
  const live = liveVersion ?? fileVersion
  const loaded: LoadedMap = {
    data,
    fileVersion,
    liveVersion: live,
    older: compareGameVersions(fileVersion, live) < 0,
  }
  await cacheSet<CachedMap>({
    key: mapKey(live),
    schemaVersion: SCHEMA_VERSION,
    fetchedAt: Date.now(),
    gameVersion: live,
    data: { data, fileVersion },
  })
  return loaded
}

/**
 * The terminal map for the LIVE game version (SPEC §5.4): fetched lazily from the app's own
 * static files, at most once per game version (cached in IndexedDB without TTL, memoized in
 * memory). A cached copy for another LIVE version is not used — a new version loads its file.
 */
export function loadTerminalMap(liveVersion: string | null): Promise<LoadedMap> {
  const key = mapKey(liveVersion ?? 'latest')
  const known = memory.get(key)
  if (known) return Promise.resolve(known)
  const running = inflight.get(key)
  if (running) return running
  const promise = (async () => {
    try {
      const cached = liveVersion ? await cacheGet<CachedMap>(key) : null
      if (cached && cached.data.data.schemaVersion === MAP_SCHEMA_VERSION) {
        const loaded: LoadedMap = {
          data: cached.data.data,
          fileVersion: cached.data.fileVersion,
          liveVersion: liveVersion ?? cached.data.fileVersion,
          older: compareGameVersions(cached.data.fileVersion, liveVersion ?? '') < 0,
        }
        memory.set(key, loaded)
        return loaded
      }
      const loaded = await load(liveVersion)
      memory.set(key, loaded)
      return loaded
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, promise)
  return promise
}
