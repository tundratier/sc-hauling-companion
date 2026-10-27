import { describe, expect, it, vi } from 'vitest'
import commodities from '../__fixtures__/commodities.json'
import pricesAll from '../__fixtures__/pricesAll.json'
import terminals from '../__fixtures__/terminals.json'
import { buildPriceIndexes, buildStaticIndexes } from './indexes'
import { mapCommodities, mapPrices, mapTerminals } from './mappers'

vi.spyOn(console, 'warn').mockImplementation(() => {})
const offers = mapPrices(pricesAll.data)

describe('buildPriceIndexes', () => {
  const { buyOffers, sellOffers } = buildPriceIndexes(offers)

  it('indexes buy offers per terminal', () => {
    expect(buyOffers.get(10)?.map((o) => o.commodityId)).toEqual([1])
    expect(buyOffers.get(15)?.map((o) => o.commodityId)).toEqual([4])
    expect(buyOffers.has(11)).toBe(false)
  })

  it('indexes sell offers per terminal and commodity', () => {
    expect(sellOffers.get(11)?.get(1)?.priceSell).toBe(3315)
    expect(sellOffers.get(10)).toBeUndefined()
  })

  it('is memoized per dataset', () => {
    expect(buildPriceIndexes(offers)).toBe(buildPriceIndexes(offers))
    expect(buildPriceIndexes([...offers])).not.toBe(buildPriceIndexes(offers))
  })
})

describe('buildStaticIndexes', () => {
  const c = mapCommodities(commodities.data)
  const t = mapTerminals(terminals.data)

  it('indexes by id and memoizes', () => {
    const idx = buildStaticIndexes(c, t)
    expect(idx.commodityById.get(1)?.name).toBe('Agricium')
    expect(idx.terminalById.get(12)?.name).toBe('Admin - Area 18')
    expect(buildStaticIndexes(c, t)).toBe(idx)
  })

  it('rebuilds when a dataset changes', () => {
    expect(buildStaticIndexes([...c], t)).not.toBe(buildStaticIndexes(c, t))
  })
})
