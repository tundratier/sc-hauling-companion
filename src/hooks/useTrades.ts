import { useMemo } from 'react'
import { buildPriceIndexes, buildStaticIndexes } from '../api/indexes'
import { calculate, EMPTY_RESULT, type CalcInput, type CalcResult } from '../calc'
import type { Vehicle } from '../domain/types'
import { useAppStore } from '../state/useAppStore'
import { useDataStore } from '../state/useDataStore'
import { useNow } from './useNow'

export interface Trades {
  input: CalcInput
  result: CalcResult
  vehicle: Vehicle | null
  /** Static data and prices are both available. */
  ready: boolean
  /** Current time (ms), refreshed every minute so ages stay current. */
  now: number
}
/** The calculation settings from the user inputs (everything but the route), memoized. */
export function useCalcSettings(): { calc: Omit<CalcInput, 'stops'>; vehicle: Vehicle | null } {
  const freeScu = useAppStore((s) => s.freeScu)
  const vehicleId = useAppStore((s) => s.vehicleId)
  const boxMin = useAppStore((s) => s.boxMin)
  const boxMax = useAppStore((s) => s.boxMax)
  const includeIllegal = useAppStore((s) => s.includeIllegal)
  const includeVolatileQt = useAppStore((s) => s.includeVolatileQt)
  const maxPriceAgeDays = useAppStore((s) => s.maxPriceAgeDays)
  const staticData = useDataStore((s) => s.staticData?.data)

  const vehicle = useMemo(
    () => staticData?.vehicles.find((v) => v.id === vehicleId) ?? null,
    [staticData, vehicleId],
  )

  const calc = useMemo<Omit<CalcInput, 'stops'>>(
    () => ({
      freeScu: Math.min(freeScu, vehicle?.scu ?? Number.MAX_SAFE_INTEGER),
      shipBoxSizes: vehicle?.containerSizes ?? null,
      boxRange: { min: boxMin, max: boxMax },
      options: { includeIllegal, includeVolatileQt, maxPriceAgeDays },
    }),
    [freeScu, vehicle, boxMin, boxMax, includeIllegal, includeVolatileQt, maxPriceAgeDays],
  )
  return { calc, vehicle }
}

/**
 * Memoized calculation: recomputes synchronously whenever an input, the static data or the
 * prices change (no API round-trip).
 */
export function useTrades(): Trades {
  const stops = useAppStore((s) => s.stops)
  const staticData = useDataStore((s) => s.staticData?.data)
  const prices = useDataStore((s) => s.prices?.data)
  const now = useNow(true, 60_000)
  const { calc, vehicle } = useCalcSettings()
  const input = useMemo<CalcInput>(() => ({ stops, ...calc }), [stops, calc])

  const indexes = useMemo(() => {
    if (!staticData || !prices) return null
    return {
      ...buildStaticIndexes(staticData.commodities, staticData.terminals),
      ...buildPriceIndexes(prices.offers),
    }
  }, [staticData, prices])

  const nowSec = Math.floor(now / 1000)
  const result = useMemo(
    () => (indexes ? calculate(input, indexes, nowSec) : EMPTY_RESULT),
    [input, indexes, nowSec],
  )

  return { input, result, vehicle, ready: indexes !== null, now }
}
