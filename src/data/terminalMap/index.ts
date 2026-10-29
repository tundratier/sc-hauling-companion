import type { TerminalMapData } from './types'

export type * from './types'

/** Supported shape of the data files; a file with another `schemaVersion` is ignored. */
export const TERMINAL_MAP_SCHEMA_VERSION = 1

const files = import.meta.glob<TerminalMapData>('./*.json', { import: 'default' })

/** `4.10.2` → `[[4, ''], [10, ''], [2, '']]`, `3.24.2a` → `[…, [2, 'a']]` */
function versionKey(version: string): [number, string][] {
  return version.split('.').map((part) => {
    const digits = /^\d*/.exec(part)?.[0] ?? ''
    return [Number(digits), part.slice(digits.length)]
  })
}

export function compareGameVersions(a: string, b: string): number {
  const ka = versionKey(a)
  const kb = versionKey(b)
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const [na, sa] = ka[i] ?? [0, '']
    const [nb, sb] = kb[i] ?? [0, '']
    if (na !== nb) return na - nb
    if (sa !== sb) return sa < sb ? -1 : 1
  }
  return 0
}

const versionOf = (path: string) => path.replace(/^\.\//, '').replace(/\.json$/, '')

/** Game versions that have a compiled map, oldest first. */
export const terminalMapVersions: string[] = Object.keys(files)
  .map(versionOf)
  .sort(compareGameVersions)

export interface LoadedTerminalMap {
  data: TerminalMapData
  /** False when the map is from an older game version than the one asked for. */
  exact: boolean
}

/**
 * The map for `gameVersion`, or the newest map of an older version (`exact: false`), or null when
 * there is none. The data is static per game version, so it is never refreshed.
 */
export async function loadTerminalMap(gameVersion: string): Promise<LoadedTerminalMap | null> {
  const candidates = terminalMapVersions.filter((v) => compareGameVersions(v, gameVersion) <= 0)
  const version = candidates.at(-1)
  if (version === undefined) return null
  const load = files[`./${version}.json`]
  if (!load) return null
  const data = await load()
  if (data.schemaVersion !== TERMINAL_MAP_SCHEMA_VERSION) return null
  return { data, exact: version === gameVersion }
}
