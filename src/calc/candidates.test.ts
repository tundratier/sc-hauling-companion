import { describe, expect, it } from 'vitest'
import {
  DAY,
  NOW,
  buyOffer,
  commodity,
  makeData,
  makeInput,
  sellOffer,
  terminal,
} from '../test-utils/calcFixtures'
import { calculate } from '.'
import { compareHauls, generateCandidates } from './candidates'

const terminals = [terminal(1), terminal(2), terminal(3)]

function gen(spec: Parameters<typeof makeData>[0], input: Parameters<typeof makeInput>[0]) {
  return generateCandidates(makeInput(input), makeData(spec), NOW)
}

const base = {
  commodities: [commodity(1)],
  terminals,
  offers: [buyOffer(1, 1, 100), sellOffer(1, 2, 150), sellOffer(1, 3, 130)],
}

describe('generateCandidates', () => {
  it('creates a haul per stop pair with buy/sell offers, including skips (A→C)', () => {
    const { hauls } = gen(base, { stops: [1, 2, 3], freeScu: 46 })
    expect(hauls.map((h) => [h.from, h.to, h.skips])).toEqual([
      [0, 1, 0],
      [0, 2, 1],
    ])
  })

  it('computes metrics at qtyMax', () => {
    const [h] = gen(base, { stops: [1, 2], freeScu: 46 }).hauls
    expect(h).toMatchObject({
      unitBuy: 100,
      unitSell: 150,
      margin: 50,
      qtyMax: 46,
      investment: 4600,
      revenue: 6900,
      profit: 2300,
    })
    expect(h.roi).toBeCloseTo(0.5)
    expect(h.boxes.reduce((s, b) => s + b.size * b.count, 0)).toBe(46)
    expect(h.id).toBe('0-1-1')
  })

  it('never sells at an earlier stop than it buys', () => {
    const { hauls } = gen(base, { stops: [2, 1] })
    expect(hauls).toEqual([])
  })

  it('treats a terminal visited twice as two independent stops', () => {
    const { hauls } = gen(base, { stops: [1, 2, 1, 2] })
    expect(hauls.map((h) => [h.from, h.to])).toEqual(
      expect.arrayContaining([
        [0, 1],
        [0, 3],
        [2, 3],
      ]),
    )
    expect(hauls).toHaveLength(3)
  })

  it('returns nothing for fewer than 2 stops or no free space', () => {
    expect(gen(base, { stops: [1] }).hauls).toEqual([])
    expect(gen(base, { stops: [1, 2], freeScu: 0 }).hauls).toEqual([])
  })

  describe('eligibility', () => {
    const run = (c: ReturnType<typeof commodity>) =>
      gen({ ...base, commodities: [c] }, { stops: [1, 2] }).hauls

    it('excludes raw, unavailable and unknown commodities', () => {
      expect(run(commodity(1, { isRaw: true }))).toHaveLength(0)
      expect(run(commodity(1, { isAvailableLive: false }))).toHaveLength(0)
      expect(run(commodity(99))).toHaveLength(0)
      expect(run(commodity(1))).toHaveLength(1)
    })

    it('skips non-positive margins', () => {
      const offers = [buyOffer(1, 1, 100), sellOffer(1, 2, 100), sellOffer(1, 3, 90)]
      expect(gen({ ...base, offers }, { stops: [1, 2, 3] }).hauls).toEqual([])
    })
  })

  describe('option filters (counted as dropped)', () => {
    it('hides illegal commodities on request', () => {
      const spec = { ...base, commodities: [commodity(1, { isIllegal: true })] }
      expect(gen(spec, { stops: [1, 2] }).hauls[0].flags.illegal).toBe(true)
      const off = gen(spec, { stops: [1, 2], options: { includeIllegal: false } })
      expect(off.hauls).toEqual([])
      expect(off.dropped.illegal).toBe(1)
    })

    it('excludes quantum-volatile commodities by default', () => {
      const spec = { ...base, commodities: [commodity(1, { isVolatileQt: true })] }
      const def = gen(spec, { stops: [1, 2] })
      expect(def.hauls).toEqual([])
      expect(def.dropped.volatileQt).toBe(1)
      const on = gen(spec, { stops: [1, 2], options: { includeVolatileQt: true } })
      expect(on.hauls).toHaveLength(1)
    })

    it('filters by price age only when asked, and always reports ages', () => {
      const offers = [
        buyOffer(1, 1, 100, { dateModified: NOW - 10 * DAY }),
        sellOffer(1, 2, 150, { dateModified: NOW - 2 * DAY }),
      ]
      const spec = { ...base, offers }
      const all = gen(spec, { stops: [1, 2] })
      expect(all.hauls[0].buyAgeDays).toBeCloseTo(10)
      expect(all.hauls[0].sellAgeDays).toBeCloseTo(2)
      const filtered = gen(spec, { stops: [1, 2], options: { maxPriceAgeDays: 5 } })
      expect(filtered.hauls).toEqual([])
      expect(filtered.dropped.priceAge).toBe(1)
      expect(gen(spec, { stops: [1, 2], options: { maxPriceAgeDays: 14 } }).hauls).toHaveLength(1)
    })

    it('treats an unknown price age as failing a max-age filter', () => {
      const offers = [buyOffer(1, 1, 100, { dateModified: 0 }), sellOffer(1, 2, 150)]
      const result = gen({ ...base, offers }, { stops: [1, 2], options: { maxPriceAgeDays: 30 } })
      expect(result.dropped.priceAge).toBe(1)
      const unfiltered = gen({ ...base, offers }, { stops: [1, 2] }).hauls[0]
      expect(unfiltered.buyAgeDays).toBeNull()
      expect(unfiltered.flags.stale).toBe(false)
    })
  })

  describe('allowed box sizes B', () => {
    it('intersects buy row, ship sizes, max box and the sell terminal limit', () => {
      const spec = {
        commodities: [commodity(1)],
        terminals: [terminal(1), terminal(2, { maxContainerSize: 8 })],
        offers: [
          buyOffer(1, 1, 100, { containerSizes: [1, 2, 4, 8, 16, 32] }),
          sellOffer(1, 2, 150),
        ],
      }
      const [h] = gen(spec, { stops: [1, 2], shipBoxSizes: [2, 4, 8, 16] }).hauls
      expect(h.boxSizes).toEqual([2, 4, 8]) // 1 and 32 not on ship, 16 > sell terminal max
      const [limited] = gen(spec, {
        stops: [1, 2],
        shipBoxSizes: [2, 4, 8, 16],
        maxBoxOverride: 4,
      }).hauls
      expect(limited.boxSizes).toEqual([2, 4])
    })

    it('drops hauls whose box set is empty and counts them', () => {
      const offers = [buyOffer(1, 1, 100, { containerSizes: [8, 16] }), sellOffer(1, 2, 150)]
      const result = gen({ ...base, offers }, { stops: [1, 2], shipBoxSizes: [1, 2, 4] })
      expect(result.hauls).toEqual([])
      expect(result.dropped.boxSize).toBe(1)
    })

    it('drops hauls when free space is smaller than the smallest box', () => {
      const offers = [buyOffer(1, 1, 100, { containerSizes: [8, 16] }), sellOffer(1, 2, 150)]
      const result = gen({ ...base, offers }, { stops: [1, 2], freeScu: 7 })
      expect(result.hauls).toEqual([])
      expect(result.dropped.boxSize).toBe(1)
    })

    it('caps qtyMax at what box granularity allows', () => {
      const offers = [buyOffer(1, 1, 100, { containerSizes: [8, 16] }), sellOffer(1, 2, 150)]
      const [h] = gen({ ...base, offers }, { stops: [1, 2], freeScu: 46 }).hauls
      expect(h.qtyMax).toBe(40)
      expect(h.boxes).toEqual([
        { size: 16, count: 2 },
        { size: 8, count: 1 },
      ])
    })

    it('falls back to the buy terminal max box when the row has no sizes (flagged)', () => {
      const spec = {
        commodities: [commodity(1)],
        terminals: [terminal(1, { maxContainerSize: 4 }), terminal(2)],
        offers: [buyOffer(1, 1, 100, { containerSizes: [] }), sellOffer(1, 2, 150)],
      }
      const [h] = gen(spec, { stops: [1, 2] }).hauls
      expect(h.boxSizes).toEqual([1, 2, 4])
      expect(h.flags.boxSizesUnknown).toBe(true)
    })

    it('falls back to all standard sizes when the terminal max is unknown (0)', () => {
      const spec = {
        commodities: [commodity(1)],
        terminals: [terminal(1, { maxContainerSize: 0 }), terminal(2, { maxContainerSize: 0 })],
        offers: [buyOffer(1, 1, 100, { containerSizes: [] }), sellOffer(1, 2, 150)],
      }
      expect(gen(spec, { stops: [1, 2] }).hauls[0].boxSizes).toEqual([1, 2, 4, 8, 16, 24, 32])
      // buy terminal missing from the index behaves the same
      const missing = { ...spec, terminals: [terminal(2)] }
      expect(gen(missing, { stops: [1, 2] }).hauls[0].boxSizes).toEqual([1, 2, 4, 8, 16, 24, 32])
    })

    it('assumes all standard sizes and caps at 32 for an unknown ship (flagged)', () => {
      const [h] = gen(base, { stops: [1, 2], shipBoxSizes: null }).hauls
      expect(h.boxSizes).toEqual([1, 2, 4, 8, 16, 24, 32])
      expect(h.flags.shipBoxSizesUnknown).toBe(true)
      expect(
        gen(base, { stops: [1, 2], shipBoxSizes: [] }).hauls[0].flags.shipBoxSizesUnknown,
      ).toBe(true)
      const [capped] = gen(base, { stops: [1, 2], shipBoxSizes: null, maxBoxOverride: 8 }).hauls
      expect(capped.boxSizes).toEqual([1, 2, 4, 8])
    })

    it('defaults max box to the largest ship size', () => {
      const [h] = gen(base, { stops: [1, 2], shipBoxSizes: [1, 2, 4] }).hauls
      expect(h.boxSizes).toEqual([1, 2, 4])
      expect(h.flags.shipBoxSizesUnknown).toBe(false)
    })
  })

  describe('reported inventory is warning-only (criterion 13)', () => {
    const withBuy = (over: Parameters<typeof buyOffer>[3]) => ({
      ...base,
      offers: [buyOffer(1, 1, 100, over), sellOffer(1, 2, 150)],
    })
    const withSell = (over: Parameters<typeof sellOffer>[3]) => ({
      ...base,
      offers: [buyOffer(1, 1, 100), sellOffer(1, 2, 150, over)],
    })

    it('keeps a haul with status_buy = 1 and scu_buy = 0 at full qtyMax with a NO STOCK? flag', () => {
      const { hauls } = gen(withBuy({ statusBuy: 1, scuBuy: 0, scuBuyAvg: 0 }), {
        stops: [1, 2],
        freeScu: 46,
      })
      expect(hauls).toHaveLength(1)
      expect(hauls[0].qtyMax).toBe(46)
      expect(hauls[0].flags).toMatchObject({ noStock: true, lowStock: false })
    })

    it('flags low stock, no demand and low demand without touching the quantity', () => {
      const low = gen(withBuy({ statusBuy: 2, scuBuy: 3 }), { stops: [1, 2], freeScu: 46 }).hauls[0]
      expect(low.flags).toMatchObject({ lowStock: true, noStock: false })
      expect(low.qtyMax).toBe(46)
      const nd = gen(withSell({ statusSell: 7 }), { stops: [1, 2] }).hauls[0]
      expect(nd.flags).toMatchObject({ noDemand: true, lowDemand: false })
      const ld = gen(withSell({ statusSell: 6 }), { stops: [1, 2] }).hauls[0]
      expect(ld.flags).toMatchObject({ lowDemand: true, noDemand: false })
    })

    it('does not re-rank hauls by inventory', () => {
      const offers = [
        buyOffer(1, 1, 100, { statusBuy: 1 }),
        sellOffer(1, 2, 150),
        buyOffer(2, 1, 100, { statusBuy: 5, scuBuy: 500 }),
        sellOffer(2, 2, 120, { statusSell: 3 }),
      ]
      const { hauls } = gen(
        { ...base, commodities: [commodity(1), commodity(2)], offers },
        { stops: [1, 2], freeScu: 10 },
      )
      expect(hauls.map((h) => h.commodity.id)).toEqual([1, 2])
    })

    it('carries reported values for display', () => {
      const offers = [
        buyOffer(1, 1, 100, { statusBuy: 3, scuBuy: 0, scuBuyAvg: 54 }),
        sellOffer(1, 2, 150, { statusSell: 5, scuSell: 14, scuSellStock: 2 }),
      ]
      const [h] = gen({ ...base, offers }, { stops: [1, 2] }).hauls
      expect(h.reported).toEqual({
        buyStatus: 3,
        scuBuy: 54, // falls back to the average
        sellStatus: 5,
        scuSell: 14,
        scuSellStock: 2,
      })
    })

    it('hides status_sell = 1 with scu_sell = 0 (unreported default) and n/a statuses', () => {
      const offers = [
        buyOffer(1, 1, 100, { statusBuy: 0 }),
        sellOffer(1, 2, 150, { statusSell: 1, scuSell: 0, scuSellStock: 4608 }),
      ]
      const [h] = gen({ ...base, offers }, { stops: [1, 2] }).hauls
      expect(h.reported).toMatchObject({
        buyStatus: null,
        sellStatus: null,
        scuSell: null,
        scuSellStock: 4608,
      })
      const shown = gen(withSell({ statusSell: 1, scuSell: 3 }), { stops: [1, 2] }).hauls[0]
      expect(shown.reported.sellStatus).toBe(1)
    })
  })

  it('sets informational flags and STALE after 7 days', () => {
    const spec = {
      commodities: [commodity(1, { isIllegal: true, isVolatileTime: true, isTemporary: true })],
      terminals,
      offers: [buyOffer(1, 1, 100, { dateModified: NOW - 8 * DAY }), sellOffer(1, 2, 150)],
    }
    const [h] = gen(spec, { stops: [1, 2] }).hauls
    expect(h.flags).toMatchObject({
      illegal: true,
      volatileTime: true,
      temporary: true,
      stale: true,
    })
    expect(gen(base, { stops: [1, 2] }).hauls[0].flags.stale).toBe(false)
  })
})

describe('compareHauls', () => {
  const offers = [
    buyOffer(1, 1, 100),
    sellOffer(1, 2, 130), // margin 30, cheap
    buyOffer(2, 1, 1000),
    sellOffer(2, 2, 1100), // margin 100, expensive, lower roi
  ]
  const { hauls } = gen(
    { ...base, commodities: [commodity(1), commodity(2)], offers },
    { stops: [1, 2], freeScu: 10 },
  )

  it('sorts descending by the chosen key', () => {
    const ids = (key: Parameters<typeof compareHauls>[0]) =>
      [...hauls].sort(compareHauls(key)).map((h) => h.commodity.id)
    expect(ids('profit')).toEqual([2, 1])
    expect(ids('margin')).toEqual([2, 1])
    expect(ids('roi')).toEqual([1, 2])
    expect(ids('investment')).toEqual([2, 1])
  })

  it('is deterministic on ties', () => {
    const a = hauls[0]
    const b = { ...hauls[0], id: 'z' }
    expect([b, a].sort(compareHauls('profit'))[0]).toBe(a)
  })
})

describe('calculate', () => {
  it('returns the empty result for invalid input', () => {
    const data = makeData(base)
    expect(calculate(makeInput({ stops: [1] }), data, NOW).hauls).toEqual([])
    expect(calculate(makeInput({ stops: [1, 2], freeScu: 0.4 }), data, NOW).plans).toEqual([])
  })

  it('returns hauls, plans and dropped counts', () => {
    const result = calculate(makeInput({ stops: [1, 2, 3], freeScu: 46 }), makeData(base), NOW)
    expect(result.hauls).toHaveLength(2)
    expect(result.plans.length).toBeGreaterThan(0)
    expect(result.dropped).toEqual({ boxSize: 0, illegal: 0, volatileQt: 0, priceAge: 0 })
  })

  it('defaults "now" to the current time', () => {
    const result = calculate(makeInput({ stops: [1, 2] }), makeData(base))
    expect(result.hauls[0].buyAgeDays).toBeGreaterThanOrEqual(0)
  })
})
