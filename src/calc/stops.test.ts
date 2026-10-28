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
import { calculate, groupByStop } from '.'

const terminals = [terminal(1), terminal(2), terminal(3), terminal(4)]

function run(
  offers: ReturnType<typeof buyOffer>[],
  commodities: ReturnType<typeof commodity>[],
  stops = [1, 2, 3],
  freeScu = 10,
) {
  return calculate(makeInput({ stops, freeScu }), makeData({ commodities, terminals, offers }), NOW)
}

describe('buy options per stop', () => {
  // A (stop 0) buys Alpha (sells at stops 1 and 2) and Beta (sells at stop 2); stop 1 buys Gamma.
  const commodities = [
    commodity(1, { name: 'Alpha' }),
    commodity(2, { name: 'Beta' }),
    commodity(3, { name: 'Gamma' }),
  ]
  const offers = [
    buyOffer(1, 1, 100),
    sellOffer(1, 2, 130), // margin 30 at stop 1
    sellOffer(1, 3, 150), // margin 50 at stop 2
    buyOffer(2, 1, 1000),
    sellOffer(2, 3, 1060), // margin 60, big investment
    buyOffer(3, 2, 10),
    sellOffer(3, 3, 25), // margin 15, roi 150 %
  ]

  it('groups hauls by buy stop, one line per (commodity, sell stop)', () => {
    const { byStop } = run(offers, commodities)
    expect(byStop).toHaveLength(3)
    expect(byStop[0].map((h) => [h.commodity.name, h.to])).toEqual([
      ['Beta', 2],
      ['Alpha', 2],
      ['Alpha', 1],
    ])
    expect(byStop[1].map((h) => [h.commodity.name, h.to])).toEqual([['Gamma', 2]])
  })

  it('a commodity sellable at two later stops appears twice; skips are flagged by skips > 0', () => {
    const { byStop } = run(offers, commodities)
    const alpha = byStop[0].filter((h) => h.commodity.name === 'Alpha')
    expect(alpha.map((h) => h.skips)).toEqual([1, 0])
  })

  it('leaves the last stop empty', () => {
    const { byStop } = run(offers, commodities)
    expect(byStop[2]).toEqual([])
  })

  it('sorts by profit by default (descending)', () => {
    const { byStop } = run(offers, commodities)
    const profits = byStop[0].map((h) => h.profit)
    expect(profits).toEqual([...profits].sort((a, b) => b - a))
    expect(profits).toEqual([600, 500, 300])
  })

  it('re-sorts all stops by ROI, margin per SCU and investment, always descending', () => {
    const { hauls } = run(offers, commodities)
    const names = (sort: Parameters<typeof groupByStop>[2]) =>
      groupByStop(hauls, 3, sort)[0].map((h) => `${h.commodity.name}${h.to}`)
    expect(names('roi')).toEqual(['Alpha2', 'Alpha1', 'Beta2']) // 50 %, 30 %, 6 %
    expect(names('margin')).toEqual(['Beta2', 'Alpha2', 'Alpha1'])
    expect(names('investment')).toEqual(['Beta2', 'Alpha2', 'Alpha1'])
    expect(groupByStop(hauls, 3, 'profit')[1].map((h) => h.commodity.name)).toEqual(['Gamma'])
  })

  it('breaks ties by margin, then commodity name', () => {
    // equal profit (qty 10): Zed margin 20 / Abe margin 20 → name; Mid margin 10 with qty... same profit impossible,
    // so use equal ROI instead: investment-sorted with identical investment
    const tie = [
      commodity(1, { name: 'Zed' }),
      commodity(2, { name: 'Abe' }),
      commodity(3, { name: 'Cheap' }),
    ]
    const tieOffers = [
      buyOffer(1, 1, 100),
      sellOffer(1, 2, 120),
      buyOffer(2, 1, 100),
      sellOffer(2, 2, 120),
      buyOffer(3, 1, 100),
      sellOffer(3, 2, 110),
    ]
    const { byStop } = run(tieOffers, tie, [1, 2], 10)
    expect(byStop[0].map((h) => h.commodity.name)).toEqual(['Abe', 'Zed', 'Cheap'])
    const { hauls } = run(tieOffers, tie, [1, 2], 10)
    // sorting by investment: all equal → margin desc → name
    expect(groupByStop(hauls, 2, 'investment')[0].map((h) => h.commodity.name)).toEqual([
      'Abe',
      'Zed',
      'Cheap',
    ])
  })

  it('treats a terminal visited twice as two independent stops', () => {
    const { byStop } = run(
      [buyOffer(1, 1, 100), sellOffer(1, 2, 120), buyOffer(2, 2, 100), sellOffer(2, 1, 130)],
      [commodity(1, { name: 'Alpha' }), commodity(2, { name: 'Beta' })],
      [1, 2, 1],
    )
    expect(byStop.map((s) => s.map((h) => h.commodity.name))).toEqual([['Alpha'], ['Beta'], []])
  })

  it('handles degenerate input', () => {
    expect(groupByStop([], 0)).toEqual([])
    expect(groupByStop([], 3)).toEqual([[], [], []])
  })

  it('never removes or demotes a line because of reported inventory', () => {
    const { byStop } = run(
      [
        buyOffer(1, 1, 100, { statusBuy: 1, scuBuy: 0, scuBuyAvg: 0 }),
        sellOffer(1, 2, 200, { statusSell: 7 }),
        buyOffer(2, 1, 100, { statusBuy: 5, scuBuy: 500 }),
        sellOffer(2, 2, 150),
      ],
      [commodity(1, { name: 'Stockless' }), commodity(2, { name: 'Plenty' })],
      [1, 2],
    )
    expect(byStop[0].map((h) => h.commodity.name)).toEqual(['Stockless', 'Plenty'])
    expect(byStop[0][0]).toMatchObject({ qtyMax: 10, flags: { noStock: true, noDemand: true } })
  })
})
