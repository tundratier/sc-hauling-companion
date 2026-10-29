import { STD_BOX_SIZES } from '../domain/types'
import { maxFillable } from './boxes'
import { allowedBoxes, filterReason } from './candidates'
import type { CalcData, CalcInput } from './types'

/** Best haul between every ordered pair of terminals. */
export interface PairProfits {
  /** Terminal ids; row/column order of the matrices. */
  ids: number[]
  /** `profit[a * n + b]`: best haul profit buying at ids[a] and selling at ids[b] (0 = none). */
  profit: Float64Array
  /** `commodity[a * n + b]`: commodity id of that best haul, 0 when there is none. */
  commodity: Int32Array
}

/**
 * Best haul profit for every ordered terminal pair, with exactly the rules of the candidate
 * generation (§6.3: eligibility, option filters, allowed boxes, full free space) but without
 * building haul objects, so it is cheap enough to run on every input change (§6.7). The result
 * does not depend on any route: a haul only depends on where it is bought and sold.
 */
export function pairProfits(
  ids: number[],
  input: Pick<CalcInput, 'freeScu' | 'shipBoxSizes' | 'boxRange' | 'options'>,
  data: CalcData,
  nowSec: number,
): PairProfits {
  const n = ids.length
  const profit = new Float64Array(n * n)
  const commodity = new Int32Array(n * n)
  const cap = Math.floor(input.freeScu)
  if (!(cap >= 1)) return { ids, profit, commodity }
  const ship =
    input.shipBoxSizes && input.shipBoxSizes.length > 0 ? input.shipBoxSizes : STD_BOX_SIZES

  for (let a = 0; a < n; a++) {
    const buyTerminal = data.terminalById.get(ids[a])
    const buys = data.buyOffers.get(ids[a])
    if (!buys) continue
    for (const buy of buys) {
      const item = data.commodityById.get(buy.commodityId)
      if (!item || item.isRaw || !item.isAvailableLive) continue
      for (let b = 0; b < n; b++) {
        const sell = data.sellOffers.get(ids[b])?.get(buy.commodityId)
        if (!sell) continue
        const margin = sell.priceSell - buy.priceBuy
        if (!(margin > 0) || filterReason(item, buy, sell, input.options, nowSec)) continue
        const { boxSizes } = allowedBoxes(
          buy,
          sell,
          buyTerminal,
          data.terminalById.get(ids[b]),
          ship,
          input.boxRange,
        )
        const qty = maxFillable(cap, boxSizes)
        const total = margin * qty
        const cell = a * n + b
        if (total > profit[cell]) {
          profit[cell] = total
          commodity[cell] = buy.commodityId
        }
      }
    }
  }
  return { ids, profit, commodity }
}
