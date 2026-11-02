import { ageDays } from '../calc/candidates'
import type { CalcData } from '../calc'
import { isDeparted, sellStopOf, type BoughtLine, type TripState } from './tripReducer'

/** A stop a waiting sell reminder can move to ("Can't sell all?", SPEC §7.6). */
export interface SellOption {
  /** Route position. */
  stop: number
  /** Sell price per SCU at that stop. */
  unitSell: number
  /** Sell price minus what the line cost per SCU. */
  deltaVsBuy: number
  /** Reported demand warning at that stop, if any (information only). */
  demand: 'noDemand' | 'lowDemand' | null
  /** The stop the reminder was originally marked for (the way back). */
  original: boolean
}

/**
 * The other not-yet-departed stops of the route that buy the line's commodity, in route order:
 * a sell offer in the current prices and an eligible commodity (§6.2; the margin does not
 * matter here, the goods are already on board). A price-age filter, when set, applies to the
 * sell row. A moved reminder also gets its original stop back while that is not departed —
 * from the current price if there is one, else from the line's snapshot. Stops before the
 * reminder's stop count too, as long as they are not departed and come after the buy stop.
 */
export function sellOptions(
  state: TripState,
  line: BoughtLine,
  stops: readonly number[],
  data: CalcData,
  opts: { nowSec: number; maxPriceAgeDays: number | null },
): SellOption[] {
  const commodity = data.commodityById.get(line.commodityId)
  const eligible = !commodity || (!commodity.isRaw && commodity.isAvailableLive)
  const here = sellStopOf(line)
  const out: SellOption[] = []
  for (let stop = line.buyStop + 1; stop < stops.length; stop++) {
    if (stop === here || isDeparted(state, stop)) continue
    const original = stop === line.sellStop
    const offer = data.sellOffers.get(stops[stop])?.get(line.commodityId)
    const age = offer ? ageDays(offer, opts.nowSec) : null
    const tooOld =
      !!offer && opts.maxPriceAgeDays !== null && (age === null || age > opts.maxPriceAgeDays)
    const usable = !!offer && eligible && !tooOld
    if (!usable && !original) continue
    const unitSell = usable && offer ? offer.priceSell : line.unitSell
    out.push({
      stop,
      unitSell,
      deltaVsBuy: unitSell - line.unitBuy,
      demand:
        usable && offer
          ? offer.statusSell === 7
            ? 'noDemand'
            : offer.statusSell === 6
              ? 'lowDemand'
              : null
          : null,
      original,
    })
  }
  return out
}
