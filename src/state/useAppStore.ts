import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Vehicle } from '../domain/types'
import { STD_BOX_SIZES } from '../domain/types'
import {
  DEFAULT_SUGGEST_OPTIONS,
  normalizeSuggestOptions,
  type StopOrigin,
  type SuggestOptions,
} from '../route/suggest/types'
import {
  INITIAL_TRIP,
  complete,
  depart,
  moveReminder,
  sameRoute,
  toggleBought,
  undo,
  type BoughtLine,
  type TripState,
} from '../trip/tripReducer'

export type Tab = 'ship' | 'route' | 'enroute' | 'trades'

/** The four steps of the use case (SPEC §7.2). */
export const TABS: { id: Tab; label: string }[] = [
  { id: 'ship', label: 'Ship' },
  { id: 'route', label: 'Route' },
  { id: 'enroute', label: 'En route' },
  { id: 'trades', label: 'Trades' },
]

const isTab = (value: unknown): value is Tab => TABS.some((t) => t.id === value)

export const MAX_STOPS = 10
export const MIN_STOPS = 2
export const MAX_FREE_SCU_NO_SHIP = 100_000
export const STORAGE_KEY = 'shc:v1'

/** User input that survives reloads (localStorage key `shc:v1`). */
export interface AppState {
  tab: Tab
  /** Selected ship (vehicle id) or null. */
  vehicleId: number | null
  /** Free cargo space C. */
  freeScu: number
  /** Box size range (standard sizes), preselected from the ship; min ≤ max. */
  boxMin: number
  boxMax: number
  showConceptShips: boolean
  includeIllegal: boolean
  includeVolatileQt: boolean
  /**
   * The ship lands in a small (S) hangar → hangar elevators take ≤ 24 SCU boxes (§6.3). Preset
   * from the ship's `pad_type` whenever the ship changes; the user can override it.
   */
  smallHangar: boolean
  /** Max aUEC for one load; null = no limit (§6.3). */
  budget: number | null
  /** Opt-in filter: hide hauls whose buy row reports NO STOCK? or LOW STOCK? (§6.1). */
  hideLowStock: boolean
  /** Optional price age filter in days; null = off. */
  maxPriceAgeDays: number | null
  showUnavailableTerminals: boolean
  /** Terminal ids in route order; the same terminal may appear more than once. */
  stops: number[]
  /**
   * Origin of each stop, parallel to `stops` (SPEC §6.7): `fixed` = entered by the user,
   * `dynamic` = an accepted suggestion. Moves with the stop on reorder, reverse and remove.
   */
  origins: StopOrigin[]
  /** Trip mode progress (SPEC §7.6); resets whenever the stop list changes. */
  trip: TripState
  /** "Add profitable stops" options (SPEC §6.7). */
  suggest: SuggestOptions

  setTab: (tab: Tab) => void
  selectVehicle: (vehicle: Vehicle | null) => void
  setFreeScu: (scu: number, shipScu?: number | null) => void
  setBoxRange: (min: number, max: number) => void
  setShowConceptShips: (v: boolean) => void
  setIncludeIllegal: (v: boolean) => void
  setIncludeVolatileQt: (v: boolean) => void
  setSmallHangar: (v: boolean) => void
  setBudget: (budget: number | null) => void
  setHideLowStock: (v: boolean) => void
  setMaxPriceAgeDays: (days: number | null) => void
  setShowUnavailableTerminals: (v: boolean) => void
  addStop: (terminalId: number) => void
  removeStop: (index: number) => void
  moveStop: (from: number, to: number) => void
  reverseStops: () => void
  clearStops: () => void
  /** Insert a terminal at `index` (accepting a suggested stop: `dynamic`, the default). */
  insertStop: (index: number, terminalId: number, origin?: StopOrigin) => void
  /** Replace the whole stop list (accepting all suggested stops); at most 10 stops. */
  replaceStops: (stops: number[], origins: StopOrigin[]) => void
  setSuggestOptions: (options: Partial<SuggestOptions>) => void
  toggleBought: (line: BoughtLine) => void
  /** Move a waiting sell reminder to another stop ("Can't sell all?", §7.6). */
  moveReminder: (key: string, stop: number, unitSell: number) => void
  departStop: () => void
  undoDepart: () => void
  /** Finish the route: clear the stops, reset the trip and open ROUTE. */
  completeRoute: () => void
}

/** Default box range: min 4 (nobody wants to load hundreds of 1-SCU boxes), max = ship's largest. */
export const DEFAULT_BOX_MIN = 4

/** Largest standard box the ship accepts; 32 when its sizes are unknown. */
export const defaultMaxBox = (vehicle: Vehicle | null): number =>
  vehicle?.containerSizes && vehicle.containerSizes.length > 0
    ? Math.max(...vehicle.containerSizes)
    : 32

export const clampFreeScu = (scu: number, shipScu?: number | null): number => {
  const max = shipScu && shipScu > 0 ? Math.floor(shipScu) : MAX_FREE_SCU_NO_SHIP
  const n = Number.isFinite(scu) ? Math.floor(scu) : 1
  return Math.min(max, Math.max(1, n))
}

/** `origins` fitted to `stops`: missing or surplus entries count as `fixed` (old saved state). */
export function normalizeOrigins(
  stops: readonly number[],
  origins: readonly StopOrigin[] | undefined,
): StopOrigin[] {
  return stops.map((_, i) => (origins?.[i] === 'dynamic' ? 'dynamic' : 'fixed'))
}

/** New stop list; the trip resets whenever the route actually changes. */
function withStops(s: AppState, stops: number[], origins: StopOrigin[]): Partial<AppState> {
  const before = normalizeOrigins(s.stops, s.origins)
  if (sameRoute(s.stops, stops)) {
    return before.every((o, i) => o === origins[i]) ? {} : { origins }
  }
  return { stops, origins, trip: INITIAL_TRIP }
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      tab: 'ship',
      vehicleId: null,
      freeScu: 32,
      boxMin: DEFAULT_BOX_MIN,
      boxMax: 32,
      showConceptShips: false,
      includeIllegal: true,
      includeVolatileQt: false,
      smallHangar: false,
      budget: null,
      hideLowStock: false,
      maxPriceAgeDays: null,
      showUnavailableTerminals: false,
      stops: [],
      origins: [],
      trip: INITIAL_TRIP,
      suggest: DEFAULT_SUGGEST_OPTIONS,

      setTab: (tab) => set({ tab }),
      selectVehicle: (vehicle) =>
        set(
          vehicle
            ? {
                vehicleId: vehicle.id,
                freeScu: clampFreeScu(vehicle.scu, vehicle.scu),
                boxMin: Math.min(DEFAULT_BOX_MIN, defaultMaxBox(vehicle)),
                boxMax: defaultMaxBox(vehicle),
                smallHangar: isSmallPad(vehicle),
              }
            : { vehicleId: null, boxMin: DEFAULT_BOX_MIN, boxMax: 32, smallHangar: false },
        ),
      setFreeScu: (scu, shipScu) => set({ freeScu: clampFreeScu(scu, shipScu) }),
      setBoxRange: (min, max) => set(normalizeBoxRange(min, max)),
      setShowConceptShips: (showConceptShips) => set({ showConceptShips }),
      setIncludeIllegal: (includeIllegal) => set({ includeIllegal }),
      setIncludeVolatileQt: (includeVolatileQt) => set({ includeVolatileQt }),
      setSmallHangar: (smallHangar) => set({ smallHangar }),
      setBudget: (budget) => set({ budget: normalizeBudget(budget) }),
      setHideLowStock: (hideLowStock) => set({ hideLowStock }),
      setMaxPriceAgeDays: (maxPriceAgeDays) => set({ maxPriceAgeDays }),
      setShowUnavailableTerminals: (showUnavailableTerminals) => set({ showUnavailableTerminals }),
      addStop: (terminalId) =>
        set((s) => {
          if (s.stops.length >= MAX_STOPS) return s
          const origins = normalizeOrigins(s.stops, s.origins)
          return withStops(s, [...s.stops, terminalId], [...origins, 'fixed'])
        }),
      removeStop: (index) =>
        set((s) => {
          const origins = normalizeOrigins(s.stops, s.origins)
          return withStops(
            s,
            s.stops.filter((_, i) => i !== index),
            origins.filter((_, i) => i !== index),
          )
        }),
      moveStop: (from, to) =>
        set((s) => {
          if (from === to || from < 0 || to < 0 || from >= s.stops.length || to >= s.stops.length) {
            return s
          }
          const stops = [...s.stops]
          const origins = normalizeOrigins(s.stops, s.origins)
          const [moved] = stops.splice(from, 1)
          const [movedOrigin] = origins.splice(from, 1)
          stops.splice(to, 0, moved)
          origins.splice(to, 0, movedOrigin)
          return withStops(s, stops, origins)
        }),
      reverseStops: () =>
        set((s) =>
          withStops(s, [...s.stops].reverse(), normalizeOrigins(s.stops, s.origins).reverse()),
        ),
      clearStops: () => set((s) => withStops(s, [], [])),
      insertStop: (index, terminalId, origin = 'dynamic') =>
        set((s) => {
          if (s.stops.length >= MAX_STOPS) return s
          const at = Math.min(Math.max(0, index), s.stops.length)
          const origins = normalizeOrigins(s.stops, s.origins)
          return withStops(
            s,
            [...s.stops.slice(0, at), terminalId, ...s.stops.slice(at)],
            [...origins.slice(0, at), origin, ...origins.slice(at)],
          )
        }),
      replaceStops: (stops, origins) =>
        set((s) =>
          stops.length > MAX_STOPS ? s : withStops(s, stops, normalizeOrigins(stops, origins)),
        ),
      setSuggestOptions: (options) =>
        set((s) => ({ suggest: normalizeSuggestOptions({ ...s.suggest, ...options }) })),
      toggleBought: (line) => set((s) => ({ trip: toggleBought(s.trip, line) })),
      moveReminder: (key, stop, unitSell) =>
        set((s) => ({ trip: moveReminder(s.trip, key, stop, unitSell) })),
      departStop: () => set((s) => ({ trip: depart(s.trip, s.stops.length) })),
      undoDepart: () => set((s) => ({ trip: undo(s.trip) })),
      completeRoute: () => set({ stops: [], origins: [], trip: complete(), tab: 'route' }),
    }),
    {
      name: STORAGE_KEY,
      // 2: four tabs, the filters move to EN ROUTE, the suggestions lose their on/off toggle
      version: 2,
      migrate: (persisted) => migratePersisted(persisted),
      // `origins` was added without a version bump: state saved before it has none, and every
      // saved stop then counts as entered by the user (`fixed`).
      merge: (persisted, current) => {
        const merged = { ...current, ...migratePersisted(persisted) }
        return { ...merged, origins: normalizeOrigins(merged.stops, merged.origins) }
      },
      partialize: (s) => ({
        tab: s.tab,
        vehicleId: s.vehicleId,
        freeScu: s.freeScu,
        boxMin: s.boxMin,
        boxMax: s.boxMax,
        showConceptShips: s.showConceptShips,
        includeIllegal: s.includeIllegal,
        includeVolatileQt: s.includeVolatileQt,
        smallHangar: s.smallHangar,
        budget: s.budget,
        hideLowStock: s.hideLowStock,
        maxPriceAgeDays: s.maxPriceAgeDays,
        showUnavailableTerminals: s.showUnavailableTerminals,
        stops: s.stops,
        origins: s.origins,
        trip: s.trip,
        suggest: s.suggest,
      }),
    },
  ),
)

/** Snap to the nearest standard size and order the ends (min ≤ max). */
export function normalizeBoxRange(min: number, max: number): { boxMin: number; boxMax: number } {
  const snap = (n: number) =>
    STD_BOX_SIZES.reduce<number>((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best), 32)
  const a = snap(min)
  const b = snap(max)
  return { boxMin: Math.min(a, b), boxMax: Math.max(a, b) }
}

/** A usable budget is a positive whole number of aUEC; anything else means "no limit". */
export function normalizeBudget(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : null
}

/**
 * What localStorage handed back, made fit for this version (anything else counts as empty):
 * an unknown tab falls back to SHIP (`ship`, `route` and `trades` keep their view), the
 * suggestion options lose the old `enabled` flag, the budget is checked. Every other key,
 * the trade filters included, stays as saved.
 */
export function migratePersisted(value: unknown): AppState {
  const saved: Partial<AppState> = typeof value === 'object' && value !== null ? { ...value } : {}
  if ('tab' in saved && !isTab(saved.tab)) saved.tab = 'ship'
  if (saved.suggest !== undefined) saved.suggest = normalizeSuggestOptions({ ...saved.suggest })
  if ('budget' in saved) saved.budget = normalizeBudget(saved.budget)
  // zustand merges the result into the full state (functions included) afterwards
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return saved as AppState
}

/** Only pad S counts as a small hangar (not XS, not M); unknown pads preset to off (§7.3). */
export const isSmallPad = (vehicle: Vehicle): boolean =>
  vehicle.padType?.trim().toUpperCase() === 'S'
