import { describe, expect, it } from 'vitest'
import {
  NOW,
  buyOffer,
  commodity,
  makeData,
  makeInput,
  sellOffer,
  terminal,
} from '../test-utils/calcFixtures'
import { calculate, generateCandidates } from '.'
import { loadQuantity } from './candidates'
import { pairProfits } from './pairProfits'

const terminals = [terminal(1), terminal(2), terminal(3)]

function gen(
  budget: number | null,
  over: Partial<Parameters<typeof makeInput>[0]> = {},
  offers = [buyOffer(1, 1, 7400), sellOffer(1, 2, 8000)],
  ends = terminals,
) {
  return generateCandidates(
    makeInput({ stops: [1, 2], freeScu: 46, budget, ...over }),
    makeData({ commodities: [commodity(1), commodity(2)], terminals: ends, offers }),
    NOW,
  )
}

describe('loadQuantity (§6.3 budget cap)', () => {
  it('is the plain fillable amount without a budget', () => {
    expect(loadQuantity(46, [8, 16], 7400, null)).toEqual({ full: 40, qty: 40 })
  })

  it('caps the amount by what the budget buys, then by the box sizes', () => {
    // 250,000 / 7,400 = 33.8 → 33 affordable → 32 with 8 and 16 SCU boxes
    expect(loadQuantity(46, [8, 16], 7400, 250_000)).toEqual({ full: 40, qty: 32 })
  })

  it('does not cap a load that fits the budget exactly', () => {
    expect(loadQuantity(40, [8, 16], 1000, 40_000)).toEqual({ full: 40, qty: 40 })
  })

  it('returns 0 when not even the smallest box is affordable', () => {
    expect(loadQuantity(46, [8, 16], 7400, 59_000)).toEqual({ full: 40, qty: 0 })
  })

  it('keeps "nothing fits" separate from "nothing affordable"', () => {
    expect(loadQuantity(7, [8, 16], 100, 1_000_000)).toEqual({ full: 0, qty: 0 })
  })
})

describe('budget in the candidate generation', () => {
  it('changes nothing without a budget', () => {
    const { hauls, dropped } = gen(null, { boxRange: { min: 8, max: 16 } })
    expect(hauls).toHaveLength(1)
    expect(hauls[0]).toMatchObject({ qtyMax: 40, budgetCap: null, unusedScu: 6 })
    expect(dropped.budget).toBe(0)
  })

  it('46 SCU at 7,400 with boxes 8 and 16 and a budget of 250,000 → 32 SCU, 236,800', () => {
    const { hauls } = gen(250_000, { boxRange: { min: 8, max: 16 } })
    expect(hauls[0]).toMatchObject({
      qtyMax: 32,
      investment: 236_800,
      budgetCap: { fullQty: 40 },
      unusedScu: 14,
    })
    expect(hauls[0].investment).toBeLessThanOrEqual(250_000)
    // profit, revenue and ROI follow the capped load
    expect(hauls[0].profit).toBe(32 * 600)
    expect(hauls[0].boxes.reduce((n, b) => n + b.size * b.count, 0)).toBe(32)
  })

  it('gives a full load that fits the budget exactly no budgetCap', () => {
    const { hauls } = gen(40 * 7400, { boxRange: { min: 8, max: 16 } })
    expect(hauls[0]).toMatchObject({ qtyMax: 40, budgetCap: null })
  })

  it('drops the trade under budget when not even one box is affordable', () => {
    const { hauls, dropped } = gen(59_000, { boxRange: { min: 8, max: 16 } })
    expect(hauls).toHaveLength(0)
    expect(dropped).toMatchObject({ budget: 1, boxTooLarge: 0 })
  })

  it('counts a trade that never fits the free space under boxTooLarge, not budget', () => {
    const { dropped } = gen(1_000_000, { freeScu: 7, boxRange: { min: 8, max: 16 } })
    expect(dropped).toMatchObject({ boxTooLarge: 1, budget: 0 })
  })

  it('combines with the elevator cap and the box range', () => {
    // outpost: 24 SCU boxes at most; range 4–32; 100 SCU free; 600/SCU buy → 30 SCU affordable → 28 with 4 SCU steps
    const outpost = terminal(2, { idSpaceStation: 0, idCity: 0 })
    const { hauls } = gen(
      18_000,
      { freeScu: 100, boxRange: { min: 4, max: 32 } },
      [buyOffer(1, 1, 600), sellOffer(1, 2, 900)],
      [terminal(1), outpost, terminal(3)],
    )
    expect(hauls[0].boxSizes).toEqual([4, 8, 16, 24])
    expect(hauls[0]).toMatchObject({ qtyMax: 28, budgetCap: { fullQty: 100 } })
    expect(hauls[0].elevatorCap).not.toBeNull()
  })
})

describe('a capped trade is ranked by its capped profit', () => {
  const offers = [
    // Gold: 700 margin per SCU but expensive (1,000 per SCU)
    buyOffer(1, 1, 1000),
    sellOffer(1, 2, 1700),
    // Scrap: 100 margin per SCU and cheap (10 per SCU)
    buyOffer(2, 1, 10),
    sellOffer(2, 2, 110),
  ]
  const run = (budget: number | null) =>
    calculate(
      makeInput({ stops: [1, 2], freeScu: 100, budget }),
      makeData({
        commodities: [commodity(1, { name: 'Gold' }), commodity(2, { name: 'Scrap' })],
        terminals,
        offers,
      }),
      NOW,
    ).byStop[0]

  it('ranks the more expensive trade first without a budget', () => {
    expect(run(null).map((h) => h.commodity.name)).toEqual(['Gold', 'Scrap'])
  })

  it('lets the capped partial load rank above others when it still earns more', () => {
    // 30,000 buys 30 Gold (21,000 profit) vs. a full Scrap load (10,000)
    const list = run(30_000)
    expect(list.map((h) => h.commodity.name)).toEqual(['Gold', 'Scrap'])
    expect(list[0]).toMatchObject({ qtyMax: 30, profit: 21_000 })
    expect(list[0].budgetCap).not.toBeNull()
    expect(list[1].budgetCap).toBeNull()
  })

  it('lets a cheaper full load outrank a trade that the budget caps hard', () => {
    // 5,000 buys 5 Gold (3,500 profit) vs. a full Scrap load (10,000)
    const list = run(5_000)
    expect(list.map((h) => h.commodity.name)).toEqual(['Scrap', 'Gold'])
    expect(list[1].qtyMax).toBe(5)
  })
})

describe('budget in the profitable-stops pair profits', () => {
  it('uses the same capped load, so the search ranks like TRADES', () => {
    const data = makeData({
      commodities: [commodity(1)],
      terminals,
      offers: [buyOffer(1, 1, 1000), sellOffer(1, 2, 1700)],
    })
    const input = makeInput({ stops: [1, 2], freeScu: 100 })
    const profit = (budget: number | null) =>
      pairProfits([1, 2], { ...input, budget }, data, NOW).profit[1]
    expect(profit(null)).toBe(70_000)
    expect(profit(30_000)).toBe(21_000)
    expect(profit(500)).toBe(0) // not even one box
  })
})
