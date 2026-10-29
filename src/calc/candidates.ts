import type { PriceOffer, Terminal } from '../domain/types'
import { STD_BOX_SIZES } from '../domain/types'
import { decomposeBoxes, maxFillable } from './boxes'
import type {
  CalcData,
  CalcInput,
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
  }
  const hauls: Haul[] = []
  const cap = Math.floor(input.freeScu)
  if (stops.length < 2 || !(cap >= 1)) return { hauls, dropped }

  const shipSizes = input.shipBoxSizes && input.shipBoxSizes.length > 0 ? input.shipBoxSizes : null
  const { min: minBox, max: maxBox } = input.boxRange
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

        // option filters (counted so the UI can say why trades are missing)
        if (!options.includeIllegal && commodity.isIllegal) {
          dropped.illegal++
          continue
        }
        if (!options.includeVolatileQt && commodity.isVolatileQt) {
          dropped.volatileQt++
          continue
        }
        const buyAge = ageDays(buy, nowSec)
        const sellAge = ageDays(sell, nowSec)
        if (
          options.maxPriceAgeDays !== null &&
          (buyAge === null ||
            sellAge === null ||
            buyAge > options.maxPriceAgeDays ||
            sellAge > options.maxPriceAgeDays)
        ) {
          dropped.priceAge++
          continue
        }

        // allowed box sizes B = STD ∩ buySizes ∩ sellSizes ∩ shipSizes ∩ [min, max]
        const buySizes = terminalSizes(buy.containerSizes, buyTerminal)
        const sellSizes = terminalSizes(sell.containerSizes, data.terminalById.get(stops[j]))
        const boxSizesUnknown = buy.containerSizes.length === 0 || sell.containerSizes.length === 0
        const usable = intersect(intersect(intersect(STD_BOX_SIZES, buySizes), sellSizes), ship)
        const boxSizes = usable.filter((s) => s >= minBox && s <= maxBox)
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
