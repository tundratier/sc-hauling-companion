import { describe, expect, it, vi } from 'vitest'
import commodities from '../__fixtures__/commodities.json'
import pricesAll from '../__fixtures__/pricesAll.json'
import terminals from '../__fixtures__/terminals.json'
import vehicles from '../__fixtures__/vehicles.json'
import {
  mapCommodities,
  mapGameVersions,
  mapPrices,
  mapTerminals,
  mapVehicles,
  parseContainerSizes,
  toBool,
  toNum,
  toStr,
} from './mappers'
import { UexError } from './uexClient'

describe('coercion helpers', () => {
  it('coerces numeric strings and treats NaN/null/undefined as 0', () => {
    expect(toNum('6')).toBe(6)
    expect(toNum('12.5')).toBe(12.5)
    expect(toNum(7)).toBe(7)
    expect(toNum(null)).toBe(0)
    expect(toNum(undefined)).toBe(0)
    expect(toNum('abc')).toBe(0)
    expect(toNum(Infinity)).toBe(0)
  })

  it('maps 0/1 integers to booleans', () => {
    expect(toBool(1)).toBe(true)
    expect(toBool('1')).toBe(true)
    expect(toBool(true)).toBe(true)
    expect(toBool(0)).toBe(false)
    expect(toBool(null)).toBe(false)
    expect(toBool('0')).toBe(false)
  })

  it('stringifies null/undefined as empty', () => {
    expect(toStr(null)).toBe('')
    expect(toStr(undefined)).toBe('')
    expect(toStr(5)).toBe('5')
  })
})

describe('parseContainerSizes', () => {
  it('parses a CSV into sorted standard sizes', () => {
    expect(parseContainerSizes('16, 1,2,4,8')).toEqual([1, 2, 4, 8, 16])
    expect(parseContainerSizes('1,2,4,8,16,24,32')).toEqual([1, 2, 4, 8, 16, 24, 32])
  })

  it('treats "", null, "null" and non-strings as unknown', () => {
    expect(parseContainerSizes('')).toEqual([])
    expect(parseContainerSizes(null)).toEqual([])
    expect(parseContainerSizes('null')).toEqual([])
    expect(parseContainerSizes(undefined)).toEqual([])
    expect(parseContainerSizes({})).toEqual([])
  })

  it('ignores non-standard sizes and duplicates', () => {
    expect(parseContainerSizes('6,12,2,2')).toEqual([2])
    expect(parseContainerSizes('6,12')).toEqual([])
    expect(parseContainerSizes(8)).toEqual([8])
  })
})

describe('mapCommodities', () => {
  it('maps flags, coerces ids and drops malformed records with one warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = mapCommodities(commodities.data)
    expect(result).toHaveLength(8)
    expect(warn).toHaveBeenCalledTimes(1)
    const byName = Object.fromEntries(result.map((c) => [c.name, c]))
    expect(byName['Taranite (Raw)'].isRaw).toBe(true)
    expect(byName['WiDoW'].isIllegal).toBe(true)
    expect(byName['Diluthermex'].isVolatileQt).toBe(true)
    expect(byName['Zeta-Prolanide'].isVolatileTime).toBe(true)
    expect(byName['Retired Goods'].isAvailableLive).toBe(false)
    // numeric-string id and "0"/"1" flags
    expect(byName['Fireworks']).toMatchObject({ id: 7, isRaw: false, isTemporary: true })
    warn.mockRestore()
  })

  it('does not warn when nothing is dropped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mapCommodities([{ id: 1, name: 'A' }])
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('throws a parse error for a non-array payload', () => {
    expect(() => mapCommodities({})).toThrow(UexError)
    expect(() => mapCommodities(null)).toThrow(/expected an array/)
  })
})

describe('mapTerminals', () => {
  const result = mapTerminals(terminals.data)

  it('maps location names, null → empty string, and numeric strings', () => {
    expect(result).toHaveLength(8)
    const area18 = result.find((t) => t.id === 11)!
    expect(area18.maxContainerSize).toBe(32)
    expect(area18.moonName).toBe('')
    expect(area18.cityName).toBe('Area 18')
    expect(area18.hasFreightElevator).toBe(true)
  })

  it('keeps unknown max container size as 0 and availability flags', () => {
    expect(result.find((t) => t.id === 13)!.maxContainerSize).toBe(0)
    expect(result.find((t) => t.id === 17)!.isAvailableLive).toBe(false)
  })

  it('maps the elevator fields: station, city and loading dock (§6.3)', () => {
    const t = (id: number) => result.find((x) => x.id === id)!
    expect(t(10)).toMatchObject({ idSpaceStation: 7, idCity: 0, hasLoadingDock: true })
    expect(t(11)).toMatchObject({ idSpaceStation: 0, idCity: 5, hasLoadingDock: false })
    expect(t(13)).toMatchObject({ idSpaceStation: 0, idCity: 0, hasLoadingDock: false })
  })

  it('treats missing or non-numeric station/city ids as 0 (planetary outpost)', () => {
    const [t] = mapTerminals([{ id: 99, id_space_station: 'x' }])
    expect(t).toMatchObject({ idSpaceStation: 0, idCity: 0 })
  })

  it('keeps non-unique displaynames distinct by id', () => {
    const area18 = result.filter((t) => t.displayname === 'Area18')
    expect(area18.map((t) => t.id)).toEqual([11, 12])
  })
})

describe('mapVehicles', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const result = mapVehicles(vehicles.data)
  warn.mockRestore()
  const byId = (id: number) => result.find((v) => v.id === id)!

  it('coerces scu strings', () => {
    expect(byId(101).scu).toBe(4608)
  })

  it('maps "", null and "null" container sizes to null (unknown)', () => {
    expect(byId(102).containerSizes).toBeNull()
    expect(byId(103).containerSizes).toBeNull()
    expect(byId(104).containerSizes).toBeNull()
  })

  it('ignores non-standard box sizes', () => {
    expect(byId(105).containerSizes).toEqual([2])
    expect(byId(100).containerSizes).toEqual([1, 2, 4, 8, 16])
  })

  it('maps display fields', () => {
    expect(byId(100)).toMatchObject({
      nameFull: 'Drake Cutlass Black',
      isSpaceship: true,
      padType: 'M',
    })
    expect(byId(102)).toMatchObject({ isConcept: true, padType: null })
  })

  it('falls back to the short name when name_full is missing', () => {
    expect(mapVehicles([{ id: 5, name: 'Foo', scu: 1 }])[0].nameFull).toBe('Foo')
  })
})

describe('mapPrices', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const result = mapPrices(pricesAll.data)
  warn.mockRestore()

  it('drops rows without ids, without any price, and non-objects', () => {
    expect(result).toHaveLength(3)
  })

  it('coerces numeric strings and keeps buy/sell side by price', () => {
    const buy = result[0]
    expect(buy).toMatchObject({
      commodityId: 1,
      terminalId: 10,
      priceBuy: 2810,
      priceSell: 0,
      scuBuy: 41,
      statusBuy: 3,
      dateModified: 1792000000,
    })
    const sell = result[1]
    expect(sell).toMatchObject({ priceSell: 3315, priceBuy: 0, scuSellStock: 2, statusSell: 1 })
  })

  it('parses container sizes per row, empty = unknown', () => {
    expect(result[0].containerSizes).toEqual([1, 2, 4, 8, 16, 24, 32])
    expect(result[2].containerSizes).toEqual([])
  })

  it('defaults missing numeric fields to 0', () => {
    expect(mapPrices([{ id_commodity: 1, id_terminal: 2, price_sell: 5 }])[0]).toMatchObject({
      priceBuy: 0,
      scuBuy: 0,
      statusSell: 0,
      dateModified: 0,
    })
  })
})

describe('mapGameVersions', () => {
  it('maps live and ptu', () => {
    expect(mapGameVersions({ live: '4.10.2', ptu: '4.10.3' })).toEqual({
      live: '4.10.2',
      ptu: '4.10.3',
    })
  })

  it('tolerates garbage', () => {
    expect(mapGameVersions(null)).toEqual({ live: '', ptu: '' })
    expect(mapGameVersions([])).toEqual({ live: '', ptu: '' })
  })
})
