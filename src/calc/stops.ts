import { compareHauls, type HaulSortKey } from './candidates'
import type { Haul } from './types'

/**
 * Buy options per stop: index i holds every haul that is bought at stop i (one line per
 * commodity and sell stop), sorted descending by `sort`. The last stop has no buy options.
 */
export function groupByStop(
  hauls: Haul[],
  stopCount: number,
  sort: HaulSortKey = 'profit',
): Haul[][] {
  const groups: Haul[][] = Array.from({ length: Math.max(0, stopCount) }, () => [])
  for (const haul of hauls) groups[haul.from]?.push(haul)
  const compare = compareHauls(sort)
  for (const group of groups) group.sort(compare)
  return groups
}
