import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Vehicle } from '../domain/types'
import { STD_BOX_SIZES } from '../domain/types'

export type Tab = 'ship' | 'route' | 'trades'

export const TABS: { id: Tab; label: string }[] = [
  { id: 'ship', label: 'Ship' },
  { id: 'route', label: 'Route' },
  { id: 'trades', label: 'Trades' },
]

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
  /** Optional price age filter in days; null = off. */
  maxPriceAgeDays: number | null
  showUnavailableTerminals: boolean
  /** Terminal ids in route order; the same terminal may appear more than once. */
  stops: number[]

  setTab: (tab: Tab) => void
  selectVehicle: (vehicle: Vehicle | null) => void
  setFreeScu: (scu: number, shipScu?: number | null) => void
  setBoxRange: (min: number, max: number) => void
  setShowConceptShips: (v: boolean) => void
  setIncludeIllegal: (v: boolean) => void
  setIncludeVolatileQt: (v: boolean) => void
  setMaxPriceAgeDays: (days: number | null) => void
  setShowUnavailableTerminals: (v: boolean) => void
  addStop: (terminalId: number) => void
  removeStop: (index: number) => void
  moveStop: (from: number, to: number) => void
  reverseStops: () => void
  clearStops: () => void
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
      maxPriceAgeDays: null,
      showUnavailableTerminals: false,
      stops: [],

      setTab: (tab) => set({ tab }),
      selectVehicle: (vehicle) =>
        set(
          vehicle
            ? {
                vehicleId: vehicle.id,
                freeScu: clampFreeScu(vehicle.scu, vehicle.scu),
                boxMin: Math.min(DEFAULT_BOX_MIN, defaultMaxBox(vehicle)),
                boxMax: defaultMaxBox(vehicle),
              }
            : { vehicleId: null, boxMin: DEFAULT_BOX_MIN, boxMax: 32 },
        ),
      setFreeScu: (scu, shipScu) => set({ freeScu: clampFreeScu(scu, shipScu) }),
      setBoxRange: (min, max) => set(normalizeBoxRange(min, max)),
      setShowConceptShips: (showConceptShips) => set({ showConceptShips }),
      setIncludeIllegal: (includeIllegal) => set({ includeIllegal }),
      setIncludeVolatileQt: (includeVolatileQt) => set({ includeVolatileQt }),
      setMaxPriceAgeDays: (maxPriceAgeDays) => set({ maxPriceAgeDays }),
      setShowUnavailableTerminals: (showUnavailableTerminals) => set({ showUnavailableTerminals }),
      addStop: (terminalId) =>
        set((s) => (s.stops.length >= MAX_STOPS ? s : { stops: [...s.stops, terminalId] })),
      removeStop: (index) => set((s) => ({ stops: s.stops.filter((_, i) => i !== index) })),
      moveStop: (from, to) =>
        set((s) => {
          if (from === to || from < 0 || to < 0 || from >= s.stops.length || to >= s.stops.length) {
            return s
          }
          const stops = [...s.stops]
          const [moved] = stops.splice(from, 1)
          stops.splice(to, 0, moved)
          return { stops }
        }),
      reverseStops: () => set((s) => ({ stops: [...s.stops].reverse() })),
      clearStops: () => set({ stops: [] }),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      partialize: (s) => ({
        tab: s.tab,
        vehicleId: s.vehicleId,
        freeScu: s.freeScu,
        boxMin: s.boxMin,
        boxMax: s.boxMax,
        showConceptShips: s.showConceptShips,
        includeIllegal: s.includeIllegal,
        includeVolatileQt: s.includeVolatileQt,
        maxPriceAgeDays: s.maxPriceAgeDays,
        showUnavailableTerminals: s.showUnavailableTerminals,
        stops: s.stops,
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
