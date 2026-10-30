import type { PriceIndexes, StaticIndexes } from '../api/indexes'
import type { Commodity, PriceOffer } from '../domain/types'
import type { BoxCount } from './boxes'
import type { ElevatorCap } from './elevator'

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
  /** Default false — opt-in: hides hauls with a NO STOCK? or LOW STOCK? buy row (reported data). */
  hideLowStock: boolean
}

export const DEFAULT_CALC_OPTIONS: CalcOptions = {
  includeIllegal: true,
  includeVolatileQt: false,
  maxPriceAgeDays: null,
  hideLowStock: false,
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
  /** The ship lands in a small (S) hangar: hangar elevators take ≤ 24 SCU boxes (§6.3). */
  smallHangar: boolean
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

/** One trade of a stopover chain (see `StopoverComparison`). */
export interface StopoverLeg {
  from: number
  to: number
  commodityName: string
  profit: number
}

/**
 * A skip haul compared with trading through the stops it skips: the most profitable chain of
 * hauls from `from` to `to` that sells at least once at a skipped stop (full hold per leg,
 * any commodity per leg; a leg without a profitable trade carries nothing).
 */
export interface StopoverComparison {
  /** Total profit of the best chain; 0 when no skipped stop has a profitable trade. */
  profit: number
  /** The chain's trades in route order (legs that carry nothing are left out). */
  legs: StopoverLeg[]
  /** Haul profit − chain profit: > 0 when skipping pays more. */
  delta: number
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
  /** Set when an elevator limit removed box sizes that would otherwise be allowed (§6.3). */
  elevatorCap: ElevatorCap | null
  /** Only for skip hauls (skips > 0); null otherwise. */
  stopovers: StopoverComparison | null
}

export interface DroppedCounts {
  /** Every size the terminals offer is above the range max or not accepted by the ship. */
  boxTooLarge: number
  /** The only sizes on offer are below the range min. */
  boxTooSmall: number
  illegal: number
  volatileQt: number
  priceAge: number
  /** Reported stock is low or empty and the "Hide low & no stock" filter is on. */
  lowStock: number
  /** Only sizes above the cargo elevator limit are on offer. */
  elevator: number
}

export interface CalcResult {
  /** Every candidate at qtyMax, one per (commodity, buy stop, sell stop), sorted by profit. */
  hauls: Haul[]
  /** Buy options per stop (index = buy stop), default sort; the last stop is always empty. */
  byStop: Haul[][]
  dropped: DroppedCounts
}

export const EMPTY_RESULT: CalcResult = {
  hauls: [],
  byStop: [],
  dropped: {
    boxTooLarge: 0,
    boxTooSmall: 0,
    illegal: 0,
    volatileQt: 0,
    priceAge: 0,
    lowStock: 0,
    elevator: 0,
  },
}
