import type { Haul } from '../calc'

/**
 * Trip mode (SPEC §7.6): pure state transitions for flying the route. No React, no storage.
 * A stop `k` is departed iff `k < currentStop`.
 */

/** A line the player marked as bought, with a snapshot so it survives price refreshes. */
export interface BoughtLine {
  /** `${buyStop}:${commodityId}:${sellStop}` */
  key: string
  buyStop: number
  sellStop: number
  commodityId: number
  commodityName: string
  unitBuy: number
  unitSell: number
  boxSizes: number[]
  illegal: boolean
  /** Position in the stop's ranked list when it was marked (to keep it in place later). */
  rank: number
}

export interface TripState {
  /** Index of the first stop not yet departed (0 at the start). */
  currentStop: number
  /** Bought lines in the order they were marked. */
  bought: BoughtLine[]
}

export const INITIAL_TRIP: TripState = { currentStop: 0, bought: [] }

export const boughtKey = (buyStop: number, commodityId: number, sellStop: number): string =>
  `${buyStop}:${commodityId}:${sellStop}`

/** Snapshot of an option line at the moment it is marked. `rank` = index in the stop's list. */
export function snapshotOf(haul: Haul, rank: number): BoughtLine {
  return {
    key: boughtKey(haul.from, haul.commodity.id, haul.to),
    buyStop: haul.from,
    sellStop: haul.to,
    commodityId: haul.commodity.id,
    commodityName: haul.commodity.name,
    unitBuy: haul.unitBuy,
    unitSell: haul.unitSell,
    boxSizes: haul.boxSizes,
    illegal: haul.flags.illegal,
    rank,
  }
}

export const isDeparted = (state: TripState, stop: number): boolean => stop < state.currentStop

export const isBought = (state: TripState, key: string): boolean =>
  state.bought.some((b) => b.key === key)

/** Clamp progress into the route (a persisted trip may outlive a shorter route). */
export function clampTrip(state: TripState, stopCount: number): TripState {
  const last = Math.max(0, stopCount - 1)
  const currentStop = Math.min(Math.max(0, Math.floor(state.currentStop)), last)
  return currentStop === state.currentStop ? state : { ...state, currentStop }
}

/** Toggle a line as bought. Only lines at the current stop can be toggled. */
export function toggleBought(state: TripState, line: BoughtLine): TripState {
  if (line.buyStop !== state.currentStop) return state
  return isBought(state, line.key)
    ? { ...state, bought: state.bought.filter((b) => b.key !== line.key) }
    : { ...state, bought: [...state.bought, line] }
}

/** Whether the DEPART button is offered (current stop, never the last one). */
export const canDepart = (state: TripState, stopCount: number): boolean =>
  stopCount >= 2 && state.currentStop < stopCount - 1

/** Leave the current stop; its bought lines become sell reminders at their sell stops. */
export function depart(state: TripState, stopCount: number): TripState {
  return canDepart(state, stopCount) ? { ...state, currentStop: state.currentStop + 1 } : state
}

/** Undo the most recent departure; its bought lines are kept. */
export function undo(state: TripState): TripState {
  return state.currentStop > 0 ? { ...state, currentStop: state.currentStop - 1 } : state
}

/** The route can be completed once every earlier stop is departed (at the last stop). */
export const canComplete = (state: TripState, stopCount: number): boolean =>
  stopCount >= 2 && state.currentStop >= stopCount - 1

/** Completing resets the trip (the caller also clears the stops and opens ROUTE). */
export const complete = (): TripState => INITIAL_TRIP

/** Bought lines (marked at `stop`), in marking order. */
export const boughtAt = (state: TripState, stop: number): BoughtLine[] =>
  state.bought.filter((b) => b.buyStop === stop)

/**
 * Sell reminders at stop `stop`: lines bought at a departed stop that sell here. Departing
 * `stop` ends its reminders (they count as "sold" in the departed summary).
 */
export function remindersAt(state: TripState, stop: number): BoughtLine[] {
  if (isDeparted(state, stop)) return []
  return state.bought.filter((b) => b.sellStop === stop && isDeparted(state, b.buyStop))
}

/** Lines from departed stops that are not sold yet (their sell stop is not departed). */
export const onBoard = (state: TripState): BoughtLine[] =>
  state.bought.filter((b) => isDeparted(state, b.buyStop) && !isDeparted(state, b.sellStop))

/** What happened at a departed stop: what was bought there and what was sold there. */
export function departedSummary(
  state: TripState,
  stop: number,
): { bought: BoughtLine[]; sold: BoughtLine[] } {
  return {
    bought: boughtAt(state, stop),
    sold: state.bought.filter((b) => b.sellStop === stop && b.buyStop < stop),
  }
}

/** One-line summary of a departed stop: `Bought Scrap, Steel · Sold Waste`. */
export function summaryText(state: TripState, stop: number): string {
  const { bought, sold } = departedSummary(state, stop)
  const names = (lines: BoughtLine[]) => [...new Set(lines.map((l) => l.commodityName))].join(', ')
  return [
    bought.length > 0 ? `Bought ${names(bought)}` : 'Nothing bought',
    sold.length > 0 ? `Sold ${names(sold)}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Whether two route stop lists are the same (a trip resets when they differ). */
export const sameRoute = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i])

/** A trip is "in progress" once a stop was departed or anything was marked. */
export const inProgress = (state: TripState): boolean =>
  state.currentStop > 0 || state.bought.length > 0

/**
 * Items to show at a stop: the ranked haul lines plus bought lines that disappeared from the
 * results (kept from their snapshot at their old position, flagged `updated`).
 */
export type StopItem =
  { kind: 'haul'; haul: Haul; key: string } | { kind: 'snapshot'; line: BoughtLine; key: string }

export function stopItems(options: Haul[], bought: BoughtLine[]): StopItem[] {
  const items: StopItem[] = options.map((haul) => ({
    kind: 'haul',
    haul,
    key: boughtKey(haul.from, haul.commodity.id, haul.to),
  }))
  const present = new Set(items.map((i) => i.key))
  const missing = [...bought.filter((b) => !present.has(b.key))].sort((a, b) => a.rank - b.rank)
  for (const line of missing) {
    items.splice(Math.min(line.rank, items.length), 0, { kind: 'snapshot', line, key: line.key })
  }
  return items
}
