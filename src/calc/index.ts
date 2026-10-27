import { generateCandidates } from './candidates'
import { buildPlans } from './plans'
import { EMPTY_RESULT, type CalcData, type CalcInput, type CalcResult } from './types'

export * from './boxes'
export { compareHauls, generateCandidates, STALE_AFTER_DAYS, type HaulSortKey } from './candidates'
export {
  buildLoad,
  buildLoads,
  buildPlans,
  capitalRequired,
  makePlan,
  onBoardPerSegment,
  TOP_K,
} from './plans'
export { buildTimeline, type TimelineAction, type TimelineStop } from './timeline'
export * from './types'

/**
 * Pure trade calculation: single hauls (result set A) and top plans (result set B) for an
 * ordered list of stops. `nowSec` (unix seconds) only affects price ages / the age filter.
 */
export function calculate(
  input: CalcInput,
  data: CalcData,
  nowSec: number = Date.now() / 1000,
): CalcResult {
  if (input.stops.length < 2 || !(Math.floor(input.freeScu) >= 1)) return EMPTY_RESULT
  const { hauls, dropped } = generateCandidates(input, data, nowSec)
  const plans = buildPlans(hauls, input.stops.length, input.freeScu)
  return { hauls, plans, dropped }
}
