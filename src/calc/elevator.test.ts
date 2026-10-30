import { describe, expect, it } from 'vitest'
import type { Terminal } from '../domain/types'
import {
  NOW,
  buyOffer,
  commodity,
  makeData,
  makeInput,
  sellOffer,
  terminal,
} from '../test-utils/calcFixtures'
import { calculate, elevatorLimit, elevatorSizes, generateCandidates } from '.'

// the four terminal kinds of the §6.3 table
const outpost = (id: number, over: Partial<Terminal> = {}) =>
  terminal(id, { idSpaceStation: 0, idCity: 0, outpostName: `Outpost ${id}`, ...over })
const city = (id: number, over: Partial<Terminal> = {}) =>
  terminal(id, { idSpaceStation: 0, idCity: 5, cityName: `City ${id}`, ...over })
const station = (id: number, over: Partial<Terminal> = {}) =>
  terminal(id, { idSpaceStation: 3, idCity: 0, ...over })
const dockStation = (id: number) => station(id, { hasLoadingDock: true })

describe('elevatorLimit / elevatorSizes (§6.3 table)', () => {
  it.each([
    ['planetary outpost', outpost(1), false, 'outpost'],
    ['planetary outpost, small hangar', outpost(1), true, 'outpost'],
    ['city', city(1), false, null],
    ['city, small hangar', city(1), true, 'smallHangar'],
    ['station without loading dock', station(1), false, null],
    ['station without loading dock, small hangar', station(1), true, 'smallHangar'],
    ['station with loading dock', dockStation(1), false, null],
    ['station with loading dock, small hangar', dockStation(1), true, null],
  ] as const)('%s', (_name, t, smallHangar, expected) => {
    expect(elevatorLimit(t, smallHangar)).toBe(expected)
  })

  it('does not limit a terminal it knows nothing about', () => {
    expect(elevatorLimit(undefined, true)).toBeNull()
  })

  it('takes the stricter of the two ends', () => {
    expect(elevatorSizes(station(1), station(2), false)).toEqual([1, 2, 4, 8, 16, 24, 32])
    expect(elevatorSizes(station(1), outpost(2), false)).toEqual([1, 2, 4, 8, 16, 24])
    expect(elevatorSizes(outpost(1), station(2), false)).toEqual([1, 2, 4, 8, 16, 24])
    expect(elevatorSizes(city(1), dockStation(2), true)).toEqual([1, 2, 4, 8, 16, 24])
    expect(elevatorSizes(dockStation(1), dockStation(2), true)).toEqual([1, 2, 4, 8, 16, 24, 32])
  })
})

function gen(
  terminals: Terminal[],
  input: Partial<Parameters<typeof makeInput>[0]> = {},
  offers = [buyOffer(1, 1, 100), sellOffer(1, 2, 150)],
) {
  return generateCandidates(
    makeInput({ stops: [1, 2], freeScu: 64, ...input }),
    makeData({ commodities: [commodity(1)], terminals, offers }),
    NOW,
  )
}

describe('elevator caps in haul generation', () => {
  it('limits an outpost ↔ station trade to 24 whatever the small-hangar toggle says', () => {
    const off = gen([station(1), outpost(2)], { smallHangar: false }).hauls[0]
    expect(off.boxSizes).toEqual([1, 2, 4, 8, 16, 24])
    expect(off.elevatorCap).toEqual({ size: 24, stops: [1], reasons: ['outpost'] })
    // with a small hangar the station end limits as well
    const on = gen([station(1), outpost(2)], { smallHangar: true }).hauls[0]
    expect(on.boxSizes).toEqual([1, 2, 4, 8, 16, 24])
    expect(on.elevatorCap).toEqual({
      size: 24,
      stops: [0, 1],
      reasons: ['smallHangar', 'outpost'],
    })
  })

  it('applies at the buy terminal too', () => {
    const [h] = gen([outpost(1), station(2)]).hauls
    expect(h.boxSizes).toEqual([1, 2, 4, 8, 16, 24])
    expect(h.elevatorCap).toEqual({ size: 24, stops: [0], reasons: ['outpost'] })
  })

  it('names every limiting stop', () => {
    const [h] = gen([outpost(1), outpost(2)]).hauls
    expect(h.elevatorCap).toEqual({ size: 24, stops: [0, 1], reasons: ['outpost', 'outpost'] })
    expect(h.qtyMax).toBe(64)
    expect(h.boxSizes.at(-1)).toBe(24)
  })

  it('leaves cities and stations at 32 with the toggle off', () => {
    const [h] = gen([city(1), station(2)], { smallHangar: false }).hauls
    expect(h.boxSizes.at(-1)).toBe(32)
    expect(h.elevatorCap).toBeNull()
  })

  it('limits cities and stations without a dock to 24 with the toggle on', () => {
    const cityTrade = gen([city(1), station(2)], { smallHangar: true }).hauls[0]
    expect(cityTrade.boxSizes.at(-1)).toBe(24)
    expect(cityTrade.elevatorCap).toEqual({
      size: 24,
      stops: [0, 1],
      reasons: ['smallHangar', 'smallHangar'],
    })
    const stationTrade = gen([station(1), station(2)], { smallHangar: true }).hauls[0]
    expect(stationTrade.boxSizes.at(-1)).toBe(24)
  })

  it('lets a station with a loading dock keep 32 even in a small hangar', () => {
    const [h] = gen([dockStation(1), dockStation(2)], { smallHangar: true }).hauls
    expect(h.boxSizes.at(-1)).toBe(32)
    expect(h.elevatorCap).toBeNull()
    // only the dock end is exempt: a plain city on the other end still limits the trade
    const mixed = gen([dockStation(1), city(2)], { smallHangar: true }).hauls[0]
    expect(mixed.boxSizes.at(-1)).toBe(24)
    expect(mixed.elevatorCap).toEqual({ size: 24, stops: [1], reasons: ['smallHangar'] })
  })

  it('overrides a larger UEX value but never raises a smaller one', () => {
    // UEX lists the outpost at 32 → still 24; a terminal that offers only up to 8 stays at 8
    const big = gen([station(1), outpost(2, { maxContainerSize: 32 })], {}, [
      buyOffer(1, 1, 100, { containerSizes: [] }),
      sellOffer(1, 2, 150, { containerSizes: [] }),
    ]).hauls[0]
    expect(big.boxSizes.at(-1)).toBe(24)
    const small = gen([station(1), outpost(2)], {}, [
      buyOffer(1, 1, 100, { containerSizes: [1, 2, 4, 8] }),
      sellOffer(1, 2, 150),
    ]).hauls[0]
    expect(small.boxSizes).toEqual([1, 2, 4, 8])
    expect(small.elevatorCap).toBeNull() // nothing was removed by the elevator
  })

  it('counts a trade that only works with 32 SCU boxes under `elevator`', () => {
    const only32 = [
      buyOffer(1, 1, 100, { containerSizes: [32] }),
      sellOffer(1, 2, 150, { containerSizes: [32] }),
    ]
    const { hauls, dropped } = gen([station(1), outpost(2)], {}, only32)
    expect(hauls).toEqual([])
    expect(dropped).toMatchObject({ elevator: 1, boxTooLarge: 0, boxTooSmall: 0 })
    // the same trade between two docks is fine
    expect(gen([dockStation(1), dockStation(2)], { smallHangar: true }, only32).hauls).toHaveLength(
      1,
    )
  })

  it('checks the elevator reason before the box range reasons', () => {
    // 32s offered, range 24–32: without the elevator B = {32}, with it B = ∅ → elevator
    const { dropped } = gen([station(1), outpost(2)], { boxRange: { min: 24, max: 32 } }, [
      buyOffer(1, 1, 100, { containerSizes: [32] }),
      sellOffer(1, 2, 150, { containerSizes: [32] }),
    ])
    expect(dropped).toMatchObject({ elevator: 1, boxTooLarge: 0, boxTooSmall: 0 })
  })

  it('still reports plain box-range drops under their own reasons', () => {
    const { dropped } = gen([station(1), station(2)], { boxRange: { min: 1, max: 8 } }, [
      buyOffer(1, 1, 100, { containerSizes: [16] }),
      sellOffer(1, 2, 150, { containerSizes: [16] }),
    ])
    expect(dropped).toMatchObject({ elevator: 0, boxTooLarge: 1 })
  })

  it('reduces the quantity when the removed size was needed', () => {
    // 56 SCU free: with 32 and 24 boxes 56 fits exactly; with only 24 it is 48
    const free = gen([station(1), station(2)], { freeScu: 56, boxRange: { min: 24, max: 32 } })
    expect(free.hauls[0].qtyMax).toBe(56)
    const capped = gen([station(1), outpost(2)], { freeScu: 56, boxRange: { min: 24, max: 32 } })
    expect(capped.hauls[0].qtyMax).toBe(48)
    expect(capped.hauls[0].unusedScu).toBe(8)
  })

  it('applies to skip hauls through the same generation (calculate)', () => {
    const result = calculate(
      makeInput({ stops: [1, 2, 3], freeScu: 64, smallHangar: true }),
      makeData({
        commodities: [commodity(1)],
        terminals: [station(1), station(2), station(3)],
        offers: [buyOffer(1, 1, 100), sellOffer(1, 2, 120), sellOffer(1, 3, 150)],
      }),
      NOW,
    )
    expect(result.hauls.every((h) => h.boxSizes.at(-1) === 24)).toBe(true)
  })
})

describe('stock filter (hideLowStock)', () => {
  const offers = (statusBuy: number) => [buyOffer(1, 1, 100, { statusBuy }), sellOffer(1, 2, 150)]
  const terminals = [station(1), station(2)]

  it.each([1, 2])('drops status_buy %i and counts it under lowStock', (status) => {
    const { hauls, dropped } = gen(terminals, { options: { hideLowStock: true } }, offers(status))
    expect(hauls).toEqual([])
    expect(dropped.lowStock).toBe(1)
  })

  it.each([0, 3, 4, 5, 6, 7])('keeps status_buy %i', (status) => {
    const { hauls, dropped } = gen(terminals, { options: { hideLowStock: true } }, offers(status))
    expect(hauls).toHaveLength(1)
    expect(dropped.lowStock).toBe(0)
  })

  it('is off by default: NO STOCK? and LOW STOCK? hauls stay, with their flags', () => {
    const none = gen(terminals, {}, offers(1)).hauls[0]
    expect(none.flags.noStock).toBe(true)
    expect(none.qtyMax).toBe(64)
    expect(gen(terminals, {}, offers(2)).hauls[0].flags.lowStock).toBe(true)
  })

  it('does not filter demand warnings', () => {
    const { hauls } = gen(terminals, { options: { hideLowStock: true } }, [
      buyOffer(1, 1, 100),
      sellOffer(1, 2, 150, { statusSell: 7 }),
    ])
    expect(hauls).toHaveLength(1)
    expect(hauls[0].flags.noDemand).toBe(true)
  })
})
