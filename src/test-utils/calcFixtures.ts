import { buildPriceIndexes, buildStaticIndexes } from '../api/indexes'
import {
  DEFAULT_CALC_OPTIONS,
  type CalcData,
  type CalcInput,
  type CalcOptions,
} from '../calc/types'
import type { Commodity, PriceOffer, Terminal } from '../domain/types'

export const NOW = 1_800_000_000 // unix seconds
export const DAY = 86_400

export const commodity = (id: number, over: Partial<Commodity> = {}): Commodity => ({
  id,
  name: `C${id}`,
  code: `C${id}`,
  kind: 'Metal',
  isRaw: false,
  isIllegal: false,
  isVolatileQt: false,
  isVolatileTime: false,
  isAvailableLive: true,
  isTemporary: false,
  ...over,
})

export const terminal = (id: number, over: Partial<Terminal> = {}): Terminal => ({
  id,
  name: `T${id}`,
  nickname: `T${id}`,
  displayname: `Terminal ${id}`,
  fullname: `Commodity Shop - T${id}`,
  code: `T${id}`,
  starSystemName: 'Stanton',
  planetName: '',
  moonName: '',
  orbitName: '',
  spaceStationName: '',
  cityName: '',
  outpostName: '',
  maxContainerSize: 32,
  isAvailableLive: true,
  isVisible: true,
  hasLoadingDock: false,
  hasFreightElevator: false,
  isAutoLoad: false,
  ...over,
})

const baseOffer = (commodityId: number, terminalId: number): PriceOffer => ({
  commodityId,
  terminalId,
  priceBuy: 0,
  priceSell: 0,
  priceBuyAvg: 0,
  priceSellAvg: 0,
  scuBuy: 0,
  scuBuyAvg: 0,
  scuSell: 0,
  scuSellAvg: 0,
  scuSellStock: 0,
  statusBuy: 0,
  statusSell: 0,
  containerSizes: [1, 2, 4, 8, 16, 24, 32],
  dateModified: NOW - DAY,
})

/** Offer where the player buys (price_buy > 0). */
export const buyOffer = (
  commodityId: number,
  terminalId: number,
  price: number,
  over: Partial<PriceOffer> = {},
): PriceOffer => ({ ...baseOffer(commodityId, terminalId), priceBuy: price, statusBuy: 4, ...over })

/** Offer where the player sells (price_sell > 0). */
export const sellOffer = (
  commodityId: number,
  terminalId: number,
  price: number,
  over: Partial<PriceOffer> = {},
): PriceOffer => ({
  ...baseOffer(commodityId, terminalId),
  priceSell: price,
  statusSell: 4,
  ...over,
})

export function makeData(spec: {
  commodities: Commodity[]
  terminals: Terminal[]
  offers: PriceOffer[]
}): CalcData {
  return {
    ...buildStaticIndexes(spec.commodities, spec.terminals),
    ...buildPriceIndexes(spec.offers),
  }
}

export const makeInput = (
  over: Omit<Partial<CalcInput>, 'options'> &
    Pick<CalcInput, 'stops'> & { options?: Partial<CalcOptions> },
): CalcInput => ({
  freeScu: 100,
  shipBoxSizes: [1, 2, 4, 8, 16, 24, 32],
  maxBoxOverride: null,
  ...over,
  options: { ...DEFAULT_CALC_OPTIONS, ...over.options },
})
