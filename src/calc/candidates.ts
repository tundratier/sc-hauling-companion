import type { Commodity, PriceOffer, Terminal } from '../domain/types'
import { STD_BOX_SIZES } from '../domain/types'
import { decomposeBoxes, maxFillable } from './boxes'
import {
  ELEVATOR_MAX_BOX,
  elevatorLimit,
  elevatorSizes,
  type ElevatorCap,
  type ElevatorReason,
} from './elevator'
import type {
  BoxRange,
  CalcData,
  CalcInput,
  CalcOptions,
  DroppedCounts,
  Haul,
  HaulFlags,
  ReportedInventory,
} from './types'

const DAY_SECONDS = 86_400
export const STALE_AFTER_DAYS = 7

export function ageDays(offer: PriceOffer, nowSec: number): number | null {
  return offer.dateModified > 0 ? Math.max(0, (nowSec - offer.dateModified) / DAY_SECONDS) : null
}

const intersect = (a: readonly number[], b: readonly number[]) => a.filter((s) => b.includes(s))

/** Sizes a terminal handles for one commodity: the row's sizes, else up to the terminal max. */
function terminalSizes(
  rowSizes: readonly number[],
  terminal: Terminal | undefined,
): readonly number[] {
  if (rowSizes.length > 0) return rowSizes
  const max = terminal?.maxContainerSize ?? 0
  return max > 0 ? STD_BOX_SIZES.filter((s) => s <= max) : STD_BOX_SIZES
}

/** Which option filter drops a profitable pair, if any (counted so the UI can say why). */
export function filterReason(
  commodity: Commodity,
  buy: PriceOffer,
  sell: PriceOffer,
  options: CalcOptions,
  nowSec: number,
): 'illegal' | 'volatileQt' | 'priceAge' | 'lowStock' | null {
  if (!options.includeIllegal && commodity.isIllegal) return 'illegal'
  if (!options.includeVolatileQt && commodity.isVolatileQt) return 'volatileQt'
  if (options.maxPriceAgeDays !== null) {
    const buyAge = ageDays(buy, nowSec)
    const sellAge = ageDays(sell, nowSec)
    if (
      buyAge === null ||
      sellAge === null ||
      buyAge > options.maxPriceAgeDays ||
      sellAge > options.maxPriceAgeDays
    ) {
      return 'priceAge'
    }
  }
  // opt-in stock filter: the buy row reports NO STOCK? (1) or LOW STOCK? (2)
  if (options.hideLowStock && (buy.statusBuy === 1 || buy.statusBuy === 2)) return 'lowStock'
  return null
}

/**
 * B = STD ∩ buy sizes ∩ sell sizes ∩ ship sizes ∩ elevator sizes ∩ [min, max] (§6.3).
 * `usable` is B before the range; `plain` is B without the elevator limit, which tells an
 * elevator-only drop from a range or ship drop and which sizes the elevator removed.
 */
export function allowedBoxes(
  buy: PriceOffer,
  sell: PriceOffer,
  buyTerminal: Terminal | undefined,
  sellTerminal: Terminal | undefined,
  ship: readonly number[],
  range: BoxRange,
  smallHangar = false,
): { usable: number[]; boxSizes: number[]; plain: number[] } {
  const buySizes = terminalSizes(buy.containerSizes, buyTerminal)
  const sellSizes = terminalSizes(sell.containerSizes, sellTerminal)
  const offered = intersect(intersect(intersect(STD_BOX_SIZES, buySizes), sellSizes), ship)
  const inRange = (s: number) => s >= range.min && s <= range.max
  const usable = intersect(offered, elevatorSizes(buyTerminal, sellTerminal, smallHangar))
  return {
    usable,
    boxSizes: usable.filter(inRange),
    plain: offered.filter(inRange),
  }
}

/** Which elevator limits (stop indices) removed sizes that were otherwise allowed. */
function elevatorCapOf(
  i: number,
  j: number,
  buyTerminal: Terminal | undefined,
  sellTerminal: Terminal | undefined,
  smallHangar: boolean,
): ElevatorCap {
  const stops: number[] = []
  const reasons: ElevatorReason[] = []
  for (const [stop, terminal] of [
    [i, buyTerminal],
    [j, sellTerminal],
  ] as const) {
    const reason = elevatorLimit(terminal, smallHangar)
    if (reason) {
      stops.push(stop)
      reasons.push(reason)
    }
  }
  return { size: ELEVATOR_MAX_BOX, stops, reasons }
}

export function reportedInventory(buy: PriceOffer, sell: PriceOffer): ReportedInventory {
  return {
    buyStatus: buy.statusBuy > 0 ? buy.statusBuy : null,
    scuBuy: buy.scuBuy || buy.scuBuyAvg,
    // status_sell = 1 together with scu_sell = 0 is most likely an unreported default.
    sellStatus:
      sell.statusSell > 0 && !(sell.statusSell === 1 && !(sell.scuSell > 0))
        ? sell.statusSell
        : null,
    scuSell: sell.scuSell > 0 ? sell.scuSell : null,
    scuSellStock: sell.scuSellStock,
  }
}

/**
 * Candidate haul generation (§6.3): every pair of stops i < j and every eligible commodity
 * with a buy offer at stops[i] and a sell offer at stops[j]. Reported inventory only sets
 * warning flags — it never removes, caps or re-ranks a haul.
 */
export function generateCandidates(
  input: CalcInput,
  data: CalcData,
  nowSec: number,
): { hauls: Haul[]; dropped: DroppedCounts } {
  const { stops, options } = input
  const dropped: DroppedCounts = {
    boxTooLarge: 0,
    boxTooSmall: 0,
    illegal: 0,
    volatileQt: 0,
    priceAge: 0,
    lowStock: 0,
    elevator: 0,
  }
  const hauls: Haul[] = []
  const cap = Math.floor(input.freeScu)
  if (stops.length < 2 || !(cap >= 1)) return { hauls, dropped }

  const shipSizes = input.shipBoxSizes && input.shipBoxSizes.length > 0 ? input.shipBoxSizes : null
  const { min: minBox } = input.boxRange
  const ship = shipSizes ?? STD_BOX_SIZES

  for (let i = 0; i < stops.length - 1; i++) {
    const buyTerminal = data.terminalById.get(stops[i])
    const buyOffers = data.buyOffers.get(stops[i])
    if (!buyOffers) continue

    for (const buy of buyOffers) {
      const commodity = data.commodityById.get(buy.commodityId)
      if (!commodity || commodity.isRaw || !commodity.isAvailableLive) continue

      for (let j = i + 1; j < stops.length; j++) {
        const sell = data.sellOffers.get(stops[j])?.get(buy.commodityId)
        if (!sell) continue
        const margin = sell.priceSell - buy.priceBuy
        if (!(margin > 0)) continue

        const reason = filterReason(commodity, buy, sell, options, nowSec)
        if (reason) {
          dropped[reason]++
          continue
        }
        const buyAge = ageDays(buy, nowSec)
        const sellAge = ageDays(sell, nowSec)

        const boxSizesUnknown = buy.containerSizes.length === 0 || sell.containerSizes.length === 0
        const sellTerminal = data.terminalById.get(stops[j])
        const { usable, boxSizes, plain } = allowedBoxes(
          buy,
          sell,
          buyTerminal,
          sellTerminal,
          ship,
          input.boxRange,
          input.smallHangar,
        )
        // only the elevator limit empties B: its own drop reason, checked before the others
        if (boxSizes.length === 0 && plain.length > 0) {
          dropped.elevator++
          continue
        }
        const qtyMax = maxFillable(cap, boxSizes)
        if (qtyMax === 0) {
          // Only sizes below the range minimum are on offer → "too small"; anything else
          // (nothing usable, above the maximum, or free space below the smallest box) → "too large".
          if (boxSizes.length === 0 && usable.length > 0 && Math.max(...usable) < minBox) {
            dropped.boxTooSmall++
          } else {
            dropped.boxTooLarge++
          }
          continue
        }
        const boxes = decomposeBoxes(qtyMax, boxSizes)

        const investment = buy.priceBuy * qtyMax
        const revenue = sell.priceSell * qtyMax
        const profit = revenue - investment
        const flags: HaulFlags = {
          illegal: commodity.isIllegal,
          volatileTime: commodity.isVolatileTime,
          temporary: commodity.isTemporary,
          noStock: buy.statusBuy === 1,
          lowStock: buy.statusBuy === 2,
          noDemand: sell.statusSell === 7,
          lowDemand: sell.statusSell === 6,
          boxSizesUnknown,
          shipBoxSizesUnknown: shipSizes === null,
          stale: (buyAge ?? 0) > STALE_AFTER_DAYS || (sellAge ?? 0) > STALE_AFTER_DAYS,
        }
        hauls.push({
          id: `${i}-${j}-${commodity.id}`,
          commodity,
          from: i,
          to: j,
          skips: j - i - 1,
          buyOffer: buy,
          sellOffer: sell,
          unitBuy: buy.priceBuy,
          unitSell: sell.priceSell,
          margin,
          boxSizes,
          qtyMax,
          unusedScu: cap - qtyMax,
          boxes,
          boxCount: boxes.reduce((n, b) => n + b.count, 0),
          investment,
          revenue,
          profit,
          roi: investment > 0 ? profit / investment : 0,
          buyAgeDays: buyAge,
          sellAgeDays: sellAge,
          reported: reportedInventory(buy, sell),
          flags,
          elevatorCap:
            plain.length > boxSizes.length
              ? elevatorCapOf(i, j, buyTerminal, sellTerminal, input.smallHangar)
              : null,
          stopovers: null,
        })
      }
    }
  }

  hauls.sort(compareHauls('profit'))
  return { hauls, dropped }
}

export type HaulSortKey = 'profit' | 'roi' | 'margin' | 'investment'

/** Descending by the chosen key; ties: margin (desc), then commodity name, then id. */
export function compareHauls(key: HaulSortKey) {
  const value = (h: Haul) =>
    key === 'margin' ? h.margin : key === 'investment' ? h.investment : h[key]
  return (a: Haul, b: Haul) =>
    value(b) - value(a) ||
    b.margin - a.margin ||
    a.commodity.name.localeCompare(b.commodity.name) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
