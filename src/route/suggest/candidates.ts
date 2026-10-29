import type { CalcData } from '../../calc'
import type { Terminal } from '../../domain/types'
import type { MapIndexes } from './map'

/**
 * Terminals that may become dynamic stops (§6.7): available and visible, with a node in the
 * terminal map, not in a city, in a star system the fixed stops already use, not a fixed stop,
 * not dismissed, and with at least one buy or sell offer of an eligible commodity.
 * Sorted by terminal id (the search is deterministic).
 */
export function candidateTerminals(
  terminals: Terminal[],
  fixed: number[],
  dismissed: number[],
  map: MapIndexes,
  data: CalcData,
): Terminal[] {
  const systems = new Set<number>()
  for (const id of fixed) {
    const node = map.nodeOfTerminal(id)
    if (node) systems.add(map.systemOf(node))
  }
  const excluded = new Set([...fixed, ...dismissed])
  const eligible = (commodityId: number) => {
    const c = data.commodityById.get(commodityId)
    return !!c && !c.isRaw && c.isAvailableLive
  }
  const hasOffer = (id: number) =>
    (data.buyOffers.get(id)?.some((o) => eligible(o.commodityId)) ?? false) ||
    [...(data.sellOffers.get(id)?.keys() ?? [])].some(eligible)

  return terminals
    .filter((t) => {
      if (!t.isAvailableLive || !t.isVisible || t.cityName.trim() !== '') return false
      if (excluded.has(t.id)) return false
      const node = map.nodeOfTerminal(t.id)
      return !!node && systems.has(map.systemOf(node)) && hasOffer(t.id)
    })
    .sort((a, b) => a.id - b.id)
}
