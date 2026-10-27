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

/**
 * Memoized calculation: recomputes synchronously whenever an input, the static data or the
 * prices change (no API round-trip).
 */
export function useTrades(): Trades {
  const stops = useAppStore((s) => s.stops)
  const freeScu = useAppStore((s) => s.freeScu)
  const vehicleId = useAppStore((s) => s.vehicleId)
  const maxBox = useAppStore((s) => s.maxBox)
  const includeIllegal = useAppStore((s) => s.includeIllegal)
  const includeVolatileQt = useAppStore((s) => s.includeVolatileQt)
  const maxPriceAgeDays = useAppStore((s) => s.maxPriceAgeDays)
  const staticData = useDataStore((s) => s.staticData?.data)
  const prices = useDataStore((s) => s.prices?.data)
  const now = useNow(true, 60_000)

  const vehicle = useMemo(
    () => staticData?.vehicles.find((v) => v.id === vehicleId) ?? null,
    [staticData, vehicleId],
  )

  const input = useMemo<CalcInput>(
    () => ({
      stops,
      freeScu: Math.min(freeScu, vehicle?.scu ?? Number.MAX_SAFE_INTEGER),
      shipBoxSizes: vehicle?.containerSizes ?? null,
      maxBoxOverride: maxBox,
      options: { includeIllegal, includeVolatileQt, maxPriceAgeDays },
    }),
    [stops, freeScu, vehicle, maxBox, includeIllegal, includeVolatileQt, maxPriceAgeDays],
  )

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
