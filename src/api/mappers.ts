import {
  STD_BOX_SIZES,
  type Commodity,
  type GameVersions,
  type PriceOffer,
  type Terminal,
  type Vehicle,
} from '../domain/types'
import { UexError } from './uexClient'

type Rec = Record<string, unknown>

/** Numeric coercion: UEX sometimes sends numeric strings; NaN/null/undefined → 0. */
export function toNum(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** UEX booleans are 0/1 integers (occasionally strings). */
export function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === '1'
}

export function toStr(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function toOptStr(value: unknown): string | null {
  const s = toStr(value)
  return s === '' || s === 'null' ? null : s
}

/**
 * CSV of box sizes → sorted unique standard sizes. Unknown/empty/"null" → []. Non-standard
 * values (6, 12, …) are ignored.
 */
export function parseContainerSizes(value: unknown): number[] {
  if (typeof value !== 'string' && typeof value !== 'number') return []
  const sizes = new Set<number>()
  for (const part of String(value).split(',')) {
    const n = Number(part.trim())
    if ((STD_BOX_SIZES as readonly number[]).includes(n)) sizes.add(n)
  }
  return [...sizes].sort((a, b) => a - b)
}

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Map every record; malformed ones (mapper returns null) are dropped with one warning. */
function mapAll<T>(dataset: string, raw: unknown, mapOne: (r: Rec) => T | null): T[] {
  if (!Array.isArray(raw)) {
    throw new UexError('parse', `Unexpected ${dataset} payload (expected an array)`)
  }
  const out: T[] = []
  let dropped = 0
  for (const item of raw) {
    const mapped = isRec(item) ? mapOne(item) : null
    if (mapped === null) dropped++
    else out.push(mapped)
  }
  if (dropped > 0) console.warn(`[uex] dropped ${dropped} malformed ${dataset} record(s)`)
  return out
}

const validId = (v: unknown) => {
  const n = toNum(v)
  return n > 0 ? n : null
}

export function mapCommodities(raw: unknown): Commodity[] {
  return mapAll('commodities', raw, (r) => {
    const id = validId(r.id)
    if (id === null) return null
    return {
      id,
      name: toStr(r.name),
      code: toStr(r.code),
      kind: toStr(r.kind),
      isRaw: toBool(r.is_raw),
      isIllegal: toBool(r.is_illegal),
      isVolatileQt: toBool(r.is_volatile_qt),
      isVolatileTime: toBool(r.is_volatile_time),
      isAvailableLive: toBool(r.is_available_live),
      isTemporary: toBool(r.is_temporary),
    }
  })
}

export function mapTerminals(raw: unknown): Terminal[] {
  return mapAll('terminals', raw, (r) => {
    const id = validId(r.id)
    if (id === null) return null
    return {
      id,
      name: toStr(r.name),
      nickname: toStr(r.nickname),
      displayname: toStr(r.displayname),
      fullname: toStr(r.fullname),
      code: toStr(r.code),
      starSystemName: toStr(r.star_system_name),
      planetName: toStr(r.planet_name),
      moonName: toStr(r.moon_name),
      orbitName: toStr(r.orbit_name),
      spaceStationName: toStr(r.space_station_name),
      cityName: toStr(r.city_name),
      outpostName: toStr(r.outpost_name),
      maxContainerSize: toNum(r.max_container_size),
      isAvailableLive: toBool(r.is_available_live),
      isVisible: toBool(r.is_visible),
      hasLoadingDock: toBool(r.has_loading_dock),
      hasFreightElevator: toBool(r.has_freight_elevator),
      isAutoLoad: toBool(r.is_auto_load),
    }
  })
}

export function mapVehicles(raw: unknown): Vehicle[] {
  return mapAll('vehicles', raw, (r) => {
    const id = validId(r.id)
    if (id === null) return null
    const sizes = parseContainerSizes(r.container_sizes)
    const name = toStr(r.name)
    return {
      id,
      name,
      nameFull: toStr(r.name_full) || name,
      scu: toNum(r.scu),
      containerSizes: sizes.length > 0 ? sizes : null,
      isConcept: toBool(r.is_concept),
      isGroundVehicle: toBool(r.is_ground_vehicle),
      isSpaceship: toBool(r.is_spaceship),
      padType: toOptStr(r.pad_type),
    }
  })
}

export function mapPrices(raw: unknown): PriceOffer[] {
  return mapAll('prices', raw, (r) => {
    const commodityId = validId(r.id_commodity)
    const terminalId = validId(r.id_terminal)
    if (commodityId === null || terminalId === null) return null
    const priceBuy = toNum(r.price_buy)
    const priceSell = toNum(r.price_sell)
    if (priceBuy <= 0 && priceSell <= 0) return null
    return {
      commodityId,
      terminalId,
      priceBuy,
      priceSell,
      priceBuyAvg: toNum(r.price_buy_avg),
      priceSellAvg: toNum(r.price_sell_avg),
      scuBuy: toNum(r.scu_buy),
      scuBuyAvg: toNum(r.scu_buy_avg),
      scuSell: toNum(r.scu_sell),
      scuSellAvg: toNum(r.scu_sell_avg),
      scuSellStock: toNum(r.scu_sell_stock),
      statusBuy: toNum(r.status_buy),
      statusSell: toNum(r.status_sell),
      containerSizes: parseContainerSizes(r.container_sizes),
      dateModified: toNum(r.date_modified),
    }
  })
}

export function mapGameVersions(raw: unknown): GameVersions {
  const r = isRec(raw) ? raw : {}
  return { live: toStr(r.live), ptu: toStr(r.ptu) }
}
