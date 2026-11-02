import { describe, expect, it } from 'vitest'
import {
  DAY,
  NOW,
  buyOffer,
  commodity,
  makeData,
  sellOffer,
  terminal,
} from '../test-utils/calcFixtures'
import { sellOptions } from './sellElsewhere'
import { moveReminder, type BoughtLine, type TripState } from './tripReducer'

// route of 5 stops (terminals 1–5); Copper bought at stop 0 for 100, marked to sell at stop 2
const stops = [1, 2, 3, 4, 5]
const line: BoughtLine = {
  key: '0:1:2',
  buyStop: 0,
  sellStop: 2,
  commodityId: 1,
  commodityName: 'Copper',
  unitBuy: 100,
  unitSell: 150,
  boxSizes: [8],
  illegal: false,
  rank: 0,
}
const at = (currentStop: number, bought = [line]): TripState => ({ currentStop, bought })
const opts = { nowSec: NOW, maxPriceAgeDays: null }

const data = (offers: ReturnType<typeof sellOffer>[], c = commodity(1, { name: 'Copper' })) =>
  makeData({
    commodities: [c],
    terminals: stops.map((id) => terminal(id)),
    offers: [buyOffer(1, 1, 100), ...offers],
  })

describe('sellOptions', () => {
  const offers = [
    sellOffer(1, 2, 120), // stop 1: earlier than the reminder
    sellOffer(1, 3, 150), // stop 2: the reminder's own stop
    sellOffer(1, 4, 160, { statusSell: 7 }), // stop 3: no demand reported
    // stop 4: does not buy Copper
  ]

  it('lists the other stops that buy the commodity, earlier and later, in route order', () => {
    const list = sellOptions(at(1), line, stops, data(offers), opts)
    expect(list.map((o) => o.stop)).toEqual([1, 3])
    expect(list[0]).toMatchObject({ unitSell: 120, deltaVsBuy: 20, demand: null, original: false })
    expect(list[1]).toMatchObject({ unitSell: 160, deltaVsBuy: 60, demand: 'noDemand' })
  })

  it('shows a low-demand warning but still offers the stop', () => {
    const list = sellOptions(
      at(1),
      line,
      stops,
      data([sellOffer(1, 4, 160, { statusSell: 6 })]),
      opts,
    )
    expect(list).toHaveLength(1)
    expect(list[0].demand).toBe('lowDemand')
  })

  it('leaves out departed stops, its own stop and stops without a sell offer', () => {
    expect(sellOptions(at(3), line, stops, data(offers), opts).map((o) => o.stop)).toEqual([3])
    expect(sellOptions(at(1), line, stops, data([sellOffer(1, 3, 150)]), opts)).toEqual([])
  })

  it('offers nothing for a commodity no other stop buys', () => {
    expect(sellOptions(at(1), line, stops, data([]), opts)).toEqual([])
  })

  it('offers the original stop again after a move, while it is not departed', () => {
    const moved = moveReminder(at(1), line.key, 3, 160)
    const [l] = moved.bought
    const list = sellOptions(moved, l, stops, data(offers), opts)
    expect(list.map((o) => [o.stop, o.original])).toEqual([
      [1, false],
      [2, true],
    ])
    expect(list[1].unitSell).toBe(150)
  })

  it('falls back to the snapshot price for the way back when the offer vanished', () => {
    const moved = moveReminder(at(1), line.key, 3, 160)
    const list = sellOptions(moved, moved.bought[0], stops, data([sellOffer(1, 4, 160)]), opts)
    expect(list.find((o) => o.original)).toMatchObject({ stop: 2, unitSell: 150, deltaVsBuy: 50 })
  })

  it('does not offer the original stop once it is departed', () => {
    const moved = moveReminder(at(1), line.key, 3, 160)
    const later = { ...moved, currentStop: 3 }
    expect(sellOptions(later, later.bought[0], stops, data(offers), opts)).toEqual([])
  })

  it('skips raw commodities and honours a price-age filter on the sell row', () => {
    expect(
      sellOptions(at(1), line, stops, data(offers, commodity(1, { isRaw: true })), opts),
    ).toEqual([])
    const old = [sellOffer(1, 2, 120, { dateModified: NOW - 9 * DAY }), sellOffer(1, 4, 160)]
    const list = sellOptions(at(1), line, stops, data(old), { nowSec: NOW, maxPriceAgeDays: 7 })
    expect(list.map((o) => o.stop)).toEqual([3])
  })

  it('treats the same terminal at two stops as two stops', () => {
    const twice = [1, 2, 3, 2, 5]
    const list = sellOptions(at(1), line, twice, data([sellOffer(1, 2, 120)]), opts)
    expect(list.map((o) => o.stop)).toEqual([1, 3])
  })
})
