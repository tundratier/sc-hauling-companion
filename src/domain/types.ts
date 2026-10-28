/** Standard SCU container (box) sizes. */
export const STD_BOX_SIZES = [1, 2, 4, 8, 16, 24, 32] as const

export interface Commodity {
  id: number
  name: string
  code: string
  /** Free text with inconsistent casing — display only. */
  kind: string
  isRaw: boolean
  isIllegal: boolean
  /** Explodes during quantum travel. */
  isVolatileQt: boolean
  /** Degrades over time. */
  isVolatileTime: boolean
  isAvailableLive: boolean
  /** Event commodity. */
  isTemporary: boolean
}

export interface Terminal {
  id: number
  name: string
  nickname: string
  /** Location name shown in-game — NOT unique. */
  displayname: string
  fullname: string
  code: string
  starSystemName: string
  planetName: string
  moonName: string
  orbitName: string
  spaceStationName: string
  cityName: string
  outpostName: string
  /** Largest box the terminal handles; 0 = unknown. */
  maxContainerSize: number
  isAvailableLive: boolean
  isVisible: boolean
  hasLoadingDock: boolean
  hasFreightElevator: boolean
  isAutoLoad: boolean
}

export interface Vehicle {
  id: number
  name: string
  nameFull: string
  scu: number
  /** Accepted box sizes (standard sizes only); null = unknown. */
  containerSizes: number[] | null
  isConcept: boolean
  isGroundVehicle: boolean
  isSpaceship: boolean
  padType: string | null
}

export interface GameVersions {
  live: string
  ptu: string
}

/**
 * One row of `commodities_prices_all`. Each row is either a buy offer
 * (`priceBuy > 0`) or a sell offer (`priceSell > 0`).
 */
export interface PriceOffer {
  commodityId: number
  terminalId: number
  /** Price the player pays per SCU. */
  priceBuy: number
  /** Price the player receives per SCU. */
  priceSell: number
  priceBuyAvg: number
  priceSellAvg: number
  /** Reported inventory fields — informational / warnings only, never used to filter. */
  scuBuy: number
  scuBuyAvg: number
  scuSell: number
  scuSellAvg: number
  scuSellStock: number
  /** Inventory level 0–7, 0 = not applicable. */
  statusBuy: number
  statusSell: number
  /** Box sizes offered/accepted for this commodity here; empty = unknown. */
  containerSizes: number[]
  /** Unix seconds. */
  dateModified: number
}
