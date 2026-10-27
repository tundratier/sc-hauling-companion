import type { Terminal, Vehicle } from './types'

/**
 * Lower-case, strip diacritics, treat `-`, `_`, `.` and `'` as spaces and collapse
 * whitespace, so "arc l1", "ARC-L1" and "Samson & Son's" compare naturally.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[-_.'’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const compact = (normalized: string) => normalized.replace(/ /g, '')

interface Haystack {
  /** Normalized, space separated. */
  text: string
  /** Same without spaces ("area 18" → "area18"). */
  compact: string
  words: string[]
}

function makeHaystack(parts: string[]): Haystack {
  const text = normalize(parts.filter(Boolean).join(' '))
  return { text, compact: compact(text), words: text.split(' ') }
}

/** Every query token must be a substring of the haystack (or of its space-less form). */
function matchesAll(tokens: string[], h: Haystack): boolean {
  return tokens.every((t) => h.text.includes(t) || h.compact.includes(t))
}

const wordStartMatch = (tokens: string[], h: Haystack) =>
  tokens.every((t) => h.words.some((w) => w.startsWith(t)))

export interface TerminalSearchEntry {
  terminal: Terminal
  haystack: Haystack
  code: string
  nickname: string
  displayname: string
}

const indexCache = new WeakMap<Terminal[], TerminalSearchEntry[]>()

/** Per-terminal normalized haystacks; built once per terminal list (memoized). */
export function buildTerminalSearchIndex(terminals: Terminal[]): TerminalSearchEntry[] {
  const cached = indexCache.get(terminals)
  if (cached) return cached
  const index = terminals.map((terminal) => ({
    terminal,
    haystack: makeHaystack([
      terminal.name,
      terminal.nickname,
      terminal.displayname,
      terminal.fullname,
      terminal.code,
      terminal.spaceStationName,
      terminal.cityName,
      terminal.outpostName,
      terminal.moonName,
      terminal.planetName,
      terminal.orbitName,
      terminal.starSystemName,
    ]),
    code: normalize(terminal.code),
    nickname: normalize(terminal.nickname),
    displayname: normalize(terminal.displayname),
  }))
  indexCache.set(terminals, index)
  return index
}

export const MAX_SEARCH_RESULTS = 12

/** Rank: exact code/nickname 0 · displayname/nickname prefix 1 · word start 2 · substring 3. */
function terminalRank(entry: TerminalSearchEntry, query: string, tokens: string[]): number {
  const q = compact(query)
  if (q === compact(entry.code) || q === compact(entry.nickname)) return 0
  const prefix = (s: string) => s.startsWith(query) || compact(s).startsWith(q)
  if (prefix(entry.displayname) || prefix(entry.nickname)) return 1
  if (wordStartMatch(tokens, entry.haystack)) return 2
  return 3
}

/**
 * Local autocomplete for terminals. `terminals` should already be filtered to the
 * available ones; the index is built per array identity.
 */
export function searchTerminals(
  terminals: Terminal[],
  rawQuery: string,
  limit: number = MAX_SEARCH_RESULTS,
): Terminal[] {
  const query = normalize(rawQuery)
  if (!query) return []
  const tokens = query.split(' ')
  return buildTerminalSearchIndex(terminals)
    .filter((e) => matchesAll(tokens, e.haystack))
    .map((e) => ({ e, rank: terminalRank(e, query, tokens) }))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.e.terminal.displayname.localeCompare(b.e.terminal.displayname) ||
        a.e.terminal.name.localeCompare(b.e.terminal.name),
    )
    .slice(0, limit)
    .map((r) => r.e.terminal)
}

/** Ship search on `name_full` + `name` with the same matching rules. */
export function searchVehicles(
  vehicles: Vehicle[],
  rawQuery: string,
  limit: number = MAX_SEARCH_RESULTS,
): Vehicle[] {
  const query = normalize(rawQuery)
  if (!query) return []
  const tokens = query.split(' ')
  return vehicles
    .map((vehicle) => ({ vehicle, h: makeHaystack([vehicle.nameFull, vehicle.name]) }))
    .filter(({ h }) => matchesAll(tokens, h))
    .map(({ vehicle, h }) => ({
      vehicle,
      rank:
        normalize(vehicle.nameFull).startsWith(query) || normalize(vehicle.name).startsWith(query)
          ? 0
          : wordStartMatch(tokens, h)
            ? 1
            : 2,
    }))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.vehicle.nameFull.localeCompare(b.vehicle.nameFull) ||
        a.vehicle.id - b.vehicle.id,
    )
    .slice(0, limit)
    .map((r) => r.vehicle)
}
