import type { StopoverLeg } from '../../calc'
import type { CalcInput } from '../../calc'

/** User options of "add profitable stops" (§6.7), persisted with the other inputs. */
export interface SuggestOptions {
  enabled: boolean
  /** Max dynamic stops between two fixed stops (0–3). */
  perGap: number
  /** Max dynamic stops in total (1–8). */
  total: number
  /** Max dynamic stops per planetary group (1–3). */
  perGroup: number
  /** Max detour in percent of the direct distance (100–300, step 10). */
  detourPct: number
}

export const DEFAULT_SUGGEST_OPTIONS: SuggestOptions = {
  enabled: false,
  perGap: 1,
  total: 4,
  perGroup: 1,
  detourPct: 150,
}

export const MAX_ROUTE_STOPS = 10

/** Clamp every option into its documented range (a persisted value may be stale). */
export function normalizeSuggestOptions(o: Partial<SuggestOptions>): SuggestOptions {
  const int = (v: unknown, lo: number, hi: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v)
      ? Math.min(hi, Math.max(lo, Math.round(v)))
      : fallback
  const d = DEFAULT_SUGGEST_OPTIONS
  return {
    enabled: o.enabled === true,
    perGap: int(o.perGap, 0, 3, d.perGap),
    total: int(o.total, 1, 8, d.total),
    perGroup: int(o.perGroup, 1, 3, d.perGroup),
    detourPct: Math.round(int(o.detourPct, 100, 300, d.detourPct) / 10) * 10,
  }
}

/** Where a route stop comes from (§6.7): entered by the user, or an accepted suggestion. */
export type StopOrigin = 'fixed' | 'dynamic'

/**
 * An accepted dynamic stop: already placed, never moved or removed by the search, but counted
 * against every limit. It sits after fixed stop `afterFixed` (-1: before the first fixed stop,
 * `fixed.length - 1`: after the last one; those two belong to no gap).
 */
export interface AcceptedStop {
  terminalId: number
  afterFixed: number
}

export interface SuggestRequest {
  /** The fixed stops: terminal ids in route order. */
  fixed: number[]
  /** Accepted dynamic stops in route order (default: none). */
  accepted?: AcceptedStop[]
  /** Current calc inputs (`stops` is ignored). */
  calc: Omit<CalcInput, 'stops'>
  options: SuggestOptions
  /** Terminals the user dismissed. */
  dismissed: number[]
  /** Unix seconds, for the price-age filter. */
  nowSec: number
  /** Time budget in ms; the search stops and flags "best found" when it is exceeded. */
  budgetMs?: number
}

/** What a dynamic stop does in the chosen chain. */
export interface SuggestedRole {
  /** Bought here and sold at `toTerminalId`. */
  buy?: { commodityName: string; toTerminalId: number; toIndex: number }
  /** Sold here, bought at `fromTerminalId`. */
  sell?: { commodityName: string; fromTerminalId: number; fromIndex: number }
}

export interface SuggestedStop {
  terminalId: number
  /** Inserted after fixed stop `gapIndex`. */
  gapIndex: number
  /** Position inside the gap (0 = first inserted stop). */
  position: number
  /** Index in the combined route (`SuggestResult.route`). */
  routeIndex: number
  /** Index in the current stop list at which it would be inserted. */
  insertAt: number
  role: SuggestedRole
}

export interface SuggestResult {
  stops: SuggestedStop[]
  profitBefore: number
  profitAfter: number
  /** Total travel distance along the route in Gm (unknown segments count 0). */
  distanceBefore: number
  distanceAfter: number
  /** The chosen chain over the combined route, §6.6 form. */
  legs: StopoverLeg[]
  /** Combined route: fixed, accepted and suggested terminal ids in order. */
  route: number[]
  /** Origin per `route` entry (suggested stops become `dynamic`). */
  origins: StopOrigin[]
  /** The time budget was hit: the best result found so far. */
  bestFound: boolean
}

export type SuggestOutcome =
  | { kind: 'ok'; result: SuggestResult }
  | { kind: 'none'; bestFound: boolean }
  /** Not computable: why (fewer than two stops, no map positions, …). */
  | { kind: 'unavailable'; reason: string }
