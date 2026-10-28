import type { PriceIndexes, StaticIndexes } from '../api/indexes'
import type { Commodity, PriceOffer } from '../domain/types'
import type { BoxCount } from './boxes'

export type { BoxCount }

export interface BoxRange {
  min: number
  max: number
}

export interface CalcOptions {
  /** Default true — illegal hauls are badged. */
  includeIllegal: boolean
  /** Default false — a hauling route always involves quantum travel. */
  includeVolatileQt: boolean
  /** Default null (no filter); ages are always shown. */
  maxPriceAgeDays: number | null
}

export const DEFAULT_CALC_OPTIONS: CalcOptions = {
  includeIllegal: true,
  includeVolatileQt: false,
  maxPriceAgeDays: null,
}

export interface CalcInput {
  /** Terminal ids in route order, length 2..10. */
  stops: number[]
  /** Free cargo space C, integer ≥ 1. */
  freeScu: number
  /** Box sizes the ship takes; null = unknown. */
  shipBoxSizes: number[] | null
  /** User-chosen box size range (values from the standard sizes), min ≤ max. */
  boxRange: BoxRange
  options: CalcOptions
}

/** Lookup tables the calculation reads (built once per dataset load). */
export type CalcData = StaticIndexes & PriceIndexes

export interface HaulFlags {
  illegal: boolean
  volatileTime: boolean
  temporary: boolean
  /** Inventory warnings — informational only, never filter or cap anything. */
  noStock: boolean
  lowStock: boolean
  noDemand: boolean
  lowDemand: boolean
  boxSizesUnknown: boolean
  shipBoxSizesUnknown: boolean
  /** Either price row is older than 7 days. */
  stale: boolean
}

export const NO_FLAGS: HaulFlags = {
  illegal: false,
  volatileTime: false,
  temporary: false,
  noStock: false,
  lowStock: false,
  noDemand: false,
  lowDemand: false,
  boxSizesUnknown: false,
  shipBoxSizesUnknown: false,
  stale: false,
}

/** Reported inventory for display next to the warnings (never used for filtering). */
export interface ReportedInventory {
  /** 1–7, null when not applicable. */
  buyStatus: number | null
  /** Reported SCU available to buy (falls back to the average). */
  scuBuy: number
  /** 1–7; null when not applicable or an unreported default (status 1 with scu_sell = 0). */
  sellStatus: number | null
  /** Only when > 0. */
  scuSell: number | null
  scuSellStock: number
}

/** One candidate trade: buy `commodity` at stop `from`, sell at stop `to` (> from). */
export interface Haul {
  id: string
  commodity: Commodity
  from: number
  to: number
  /** Stops passed without selling: to − from − 1. */
  skips: number
  buyOffer: PriceOffer
  sellOffer: PriceOffer
  unitBuy: number
  unitSell: number
  /** Profit per SCU. */
  margin: number
  /** Allowed box sizes B. */
  boxSizes: number[]
  /** Largest fillable quantity ≤ free SCU. */
  qtyMax: number
  /** Free SCU that cannot be filled with the allowed boxes (cap − qtyMax). */
  unusedScu: number
  boxes: BoxCount[]
  /** Total number of boxes in the breakdown. */
  boxCount: number
  investment: number
  revenue: number
  profit: number
  roi: number
  /** Price ages in days, null when unknown. */
  buyAgeDays: number | null
  sellAgeDays: number | null
  reported: ReportedInventory
  flags: HaulFlags
}

export interface LoadPart {
  haul: Haul
  qty: number
  boxes: BoxCount[]
  investment: number
  revenue: number
  profit: number
}

/** What is carried from stop `from` to stop `to`. */
export interface Load {
  from: number
  to: number
  parts: LoadPart[]
  scu: number
  investment: number
  revenue: number
  profit: number
}

export interface Plan {
  /** Loads in route order, non-overlapping. */
  loads: Load[]
  profit: number
  investment: number
  revenue: number
  roi: number
  /** Maximum SCU on board over all segments. */
  peakScu: number
  /** Cash needed up front (sell first, then buy at every stop). */
  capitalRequired: number
  /** Number of BUY plus SELL lines. */
  transactions: number
  oldestPriceAgeDays: number | null
  /** Parts with an inventory warning (NO/LOW STOCK?, NO/LOW DEMAND?). */
  warningCount: number
  flags: HaulFlags
  key: string
}

export interface DroppedCounts {
  /** Every size the terminals offer is above the range max or not accepted by the ship. */
  boxTooLarge: number
  /** The only sizes on offer are below the range min. */
  boxTooSmall: number
  illegal: number
  volatileQt: number
  priceAge: number
}

export interface CalcResult {
  /** Result set A: every candidate at qtyMax, sorted by profit desc. */
  hauls: Haul[]
  /** Result set B: best plans, first is MAX. */
  plans: Plan[]
  dropped: DroppedCounts
}

export const EMPTY_RESULT: CalcResult = {
  hauls: [],
  plans: [],
  dropped: { boxTooLarge: 0, boxTooSmall: 0, illegal: 0, volatileQt: 0, priceAge: 0 },
}
