import { generateCandidates } from './candidates'
import { groupByStop } from './stops'
import { compareStopovers } from './stopovers'
import { EMPTY_RESULT, type CalcData, type CalcInput, type CalcResult } from './types'

export * from './boxes'
export { compareHauls, generateCandidates, STALE_AFTER_DAYS, type HaulSortKey } from './candidates'
export { groupByStop } from './stops'
export { compareStopovers } from './stopovers'
export * from './types'

/**
 * Pure trade calculation: every candidate haul (skip hauls compared with their stopovers) and
 * the buy options grouped per stop (profit-sorted; re-sort with `groupByStop`). `nowSec` (unix
 * seconds) only affects price ages and the age filter.
 */
export function calculate(
  input: CalcInput,
  data: CalcData,
  nowSec: number = Date.now() / 1000,
): CalcResult {
  if (input.stops.length < 2 || !(Math.floor(input.freeScu) >= 1)) return EMPTY_RESULT
  const candidates = generateCandidates(input, data, nowSec)
  const hauls = compareStopovers(candidates.hauls, input.stops.length)
  const { dropped } = candidates
  return { hauls, byStop: groupByStop(hauls, input.stops.length), dropped }
}
