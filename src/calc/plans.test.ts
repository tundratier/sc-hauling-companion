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
import { buildLoad, buildLoads, buildPlans, buildTimeline, calculate, onBoardPerSegment } from '.'
import { generateCandidates } from './candidates'
import { capitalRequired } from './plans'
import type { Haul } from './types'

const T = [terminal(1), terminal(2), terminal(3), terminal(4)]

function run(
  spec: Omit<Parameters<typeof makeData>[0], 'terminals'> & { terminals?: typeof T },
  input: Parameters<typeof makeInput>[0],
) {
  const data = makeData({ terminals: T, ...spec })
  return calculate(makeInput(input), data, NOW)
}

describe('plan DP', () => {
  // Counter-example where greedy fails (§6.5): A→C margin 10 vs A→B + B→C margin 8 each.
  const counterExample = {
    commodities: [
      commodity(1, { name: 'X' }),
      commodity(2, { name: 'Y' }),
      commodity(3, { name: 'Z' }),
    ],
    offers: [
      buyOffer(1, 1, 100),
      sellOffer(1, 3, 110), // X: A→C margin 10
      buyOffer(2, 1, 100),
      sellOffer(2, 2, 108), // Y: A→B margin 8
      buyOffer(3, 2, 100),
      sellOffer(3, 3, 108), // Z: B→C margin 8
    ],
  }

  it('picks Y + Z (1,600) over X (1,000) and lists X as plan #2', () => {
    const { plans } = run(counterExample, { stops: [1, 2, 3], freeScu: 100 })
    expect(plans[0].profit).toBe(1600)
    expect(plans[0].loads.map((l) => [l.from, l.to, l.parts[0].haul.commodity.name])).toEqual([
      [0, 1, 'Y'],
      [1, 2, 'Z'],
    ])
    expect(plans[1].profit).toBe(1000)
    expect(plans[1].loads).toHaveLength(1)
    expect(plans[1].loads[0].parts[0].haul.commodity.name).toBe('X')
    expect(plans[1].loads[0].parts[0].haul.skips).toBe(1)
  })

  it('returns distinct plans ordered by profit, best first', () => {
    const { plans } = run(counterExample, { stops: [1, 2, 3], freeScu: 100 })
    expect(plans.map((p) => p.profit)).toEqual([1600, 1000, 800, 800])
    expect(new Set(plans.map((p) => p.key)).size).toBe(plans.length)
  })

  it('returns no plans without candidates', () => {
    expect(run({ commodities: [commodity(1)], offers: [] }, { stops: [1, 2] }).plans).toEqual([])
    expect(buildPlans([], 3, 10)).toEqual([])
    expect(buildPlans([{} as Haul], 1, 10)).toEqual([])
  })

  it('keeps at most K plans', () => {
    // six loads (every stop pair) → far more than 5 distinct non-empty plans
    const commodities = [1, 2, 3].map((id) => commodity(id))
    const offers = [
      buyOffer(1, 1, 100),
      sellOffer(1, 2, 110),
      sellOffer(1, 3, 115),
      sellOffer(1, 4, 125),
      buyOffer(2, 2, 100),
      sellOffer(2, 3, 112),
      sellOffer(2, 4, 118),
      buyOffer(3, 3, 100),
      sellOffer(3, 4, 109),
    ]
    const input = { stops: [1, 2, 3, 4], freeScu: 10 }
    const { plans, hauls } = run({ commodities, offers }, input)
    expect(plans).toHaveLength(5)
    expect(plans.map((p) => p.profit)).toEqual(
      [...plans.map((p) => p.profit)].sort((a, b) => b - a),
    )
    expect(new Set(plans.map((p) => p.key)).size).toBe(5)
    const small = buildPlans(hauls, 4, 10, 2)
    expect(small).toHaveLength(2)
    expect(small.map((p) => p.key)).toEqual(plans.slice(0, 2).map((p) => p.key))
  })

  it('handles a terminal visited twice as independent stops', () => {
    const offers = [
      buyOffer(1, 1, 100),
      sellOffer(1, 2, 120),
      buyOffer(2, 2, 125),
      sellOffer(2, 1, 150),
    ]
    const { plans } = run(
      { commodities: [commodity(1), commodity(2)], offers },
      { stops: [1, 2, 1], freeScu: 10 },
    )
    expect(plans[0].profit).toBe(450)
    expect(plans[0].loads.map((l) => [l.from, l.to])).toEqual([
      [0, 1],
      [1, 2],
    ])
  })

  it('never exceeds free SCU on any segment and never overlaps loads', () => {
    let seed = 7
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    for (let round = 0; round < 40; round++) {
      const n = 2 + Math.floor(rnd() * 5)
      const stops = Array.from({ length: n }, () => 1 + Math.floor(rnd() * 4))
      const commodities = [1, 2, 3, 4].map((id) => commodity(id))
      const offers = []
      for (const c of commodities) {
        for (const t of [1, 2, 3, 4]) {
          const price = 50 + Math.floor(rnd() * 100)
          const sizes = [[1, 2, 4, 8, 16], [8, 16], [4, 24], [32], [1]][Math.floor(rnd() * 5)]
          offers.push(
            rnd() < 0.5
              ? buyOffer(c.id, t, price, { containerSizes: sizes })
              : sellOffer(c.id, t, price, { containerSizes: sizes }),
          )
        }
      }
      const freeScu = 1 + Math.floor(rnd() * 120)
      const result = run({ commodities, offers }, { stops, freeScu })
      for (const plan of result.plans) {
        expect(plan.peakScu).toBeLessThanOrEqual(freeScu)
        for (const seg of onBoardPerSegment(plan.loads, n)) expect(seg).toBeLessThanOrEqual(freeScu)
        plan.loads.forEach((load, k) => {
          expect(load.to).toBeGreaterThan(load.from)
          if (k > 0) expect(load.from).toBeGreaterThanOrEqual(plan.loads[k - 1].to)
          for (const p of load.parts) {
            // representable by the allowed box sizes
            expect(p.boxes.reduce((s, b) => s + b.size * b.count, 0)).toBe(p.qty)
            expect(p.boxes.every((b) => p.haul.boxSizes.includes(b.size))).toBe(true)
          }
        })
      }
      // The DP matches exhaustive search over all non-overlapping load sets.
      const loads = [...buildLoads(result.hauls, freeScu).values()]
      const totals = new Set<number>()
      const walk = (pos: number, sum: number, count: number) => {
        if (count > 0) totals.add(sum)
        for (const l of loads) if (l.from >= pos) walk(l.to, sum + l.profit, count + 1)
      }
      walk(0, 0, 0)
      if (result.plans.length > 0) expect(result.plans[0].profit).toBe(Math.max(...totals))
      else expect(totals.size).toBe(0)
    }
  })
})

describe('loads', () => {
  const hauls = (
    specs: { id: number; buy: number; sell: number; sizes: number[] }[],
    scu: number,
  ) =>
    generateCandidates(
      makeInput({ stops: [1, 2], freeScu: scu }),
      makeData({
        terminals: T,
        commodities: specs.map((s) => commodity(s.id)),
        offers: specs.flatMap((s) => [
          buyOffer(s.id, 1, s.buy, { containerSizes: s.sizes }),
          sellOffer(s.id, 2, s.sell),
        ]),
      }),
      NOW,
    ).hauls

  it('fills leftover space with the next best commodity when box granularity leaves a gap', () => {
    const candidates = hauls(
      [
        { id: 1, buy: 100, sell: 120, sizes: [8, 16] }, // margin 20, 40 of 46 SCU
        { id: 2, buy: 100, sell: 110, sizes: [1, 2, 4, 8, 16] }, // margin 10 fills the rest
        { id: 3, buy: 100, sell: 105, sizes: [1, 2, 4, 8, 16] }, // margin 5, not needed
      ],
      46,
    )
    const load = buildLoad(0, 1, candidates, 46)!
    expect(load.parts.map((p) => [p.haul.commodity.id, p.qty])).toEqual([
      [1, 40],
      [2, 6],
    ])
    expect(load.scu).toBe(46)
    expect(load.profit).toBe(40 * 20 + 6 * 10)
    expect(load.investment).toBe(46 * 100)
    expect(load.revenue).toBe(40 * 120 + 6 * 110)
  })

  it('is a single commodity when the boxes fit exactly', () => {
    const candidates = hauls(
      [
        { id: 1, buy: 100, sell: 120, sizes: [1, 2, 4, 8, 16] },
        { id: 2, buy: 100, sell: 110, sizes: [1, 2, 4, 8, 16] },
      ],
      46,
    )
    const load = buildLoad(0, 1, candidates, 46)!
    expect(load.parts).toHaveLength(1)
    expect(load.parts[0].qty).toBe(46)
  })

  it('returns null when nothing fits', () => {
    expect(buildLoad(0, 1, [], 46)).toBeNull()
    expect(buildLoad(0, 1, hauls([{ id: 1, buy: 1, sell: 2, sizes: [8] }], 46), 4)).toBeNull()
  })

  it('breaks margin ties deterministically', () => {
    const candidates = hauls(
      [
        { id: 2, buy: 100, sell: 120, sizes: [1] },
        { id: 1, buy: 100, sell: 120, sizes: [1] },
      ],
      10,
    )
    expect(buildLoad(0, 1, candidates, 10)!.parts[0].haul.commodity.id).toBe(1)
  })

  it('builds one load per stop pair', () => {
    const data = makeData({
      terminals: T,
      commodities: [commodity(1)],
      offers: [buyOffer(1, 1, 100), sellOffer(1, 2, 120), sellOffer(1, 3, 130)],
    })
    const { hauls: hs } = generateCandidates(
      makeInput({ stops: [1, 2, 3], freeScu: 10 }),
      data,
      NOW,
    )
    expect([...buildLoads(hs, 10).keys()].sort()).toEqual(['0-1', '0-2'])
  })
})

describe('plan metrics', () => {
  // A→B commodity 1 (buy 100 → sell 120), B→C commodity 2 (buy 130 → sell 150), 10 SCU free
  const spec = {
    commodities: [commodity(1), commodity(2)],
    offers: [
      buyOffer(1, 1, 100, { dateModified: NOW - 5 * DAY }),
      sellOffer(1, 2, 120),
      buyOffer(2, 2, 130, { statusBuy: 1 }),
      sellOffer(2, 3, 150, { dateModified: NOW - 12 * DAY }),
    ],
  }
  const { plans } = run(spec, { stops: [1, 2, 3], freeScu: 10 })
  const max = plans[0]

  it('sums profit, investment and ROI', () => {
    expect(max.profit).toBe(400)
    expect(max.investment).toBe(2300)
    expect(max.revenue).toBe(2700)
    expect(max.roi).toBeCloseTo(400 / 2300)
    expect(max.transactions).toBe(4)
  })

  it('computes capital required with sell-before-buy at each stop', () => {
    // stop 0: −1000 · stop 1: +1200 −1300 → −1100 · stop 2: +1500
    expect(max.capitalRequired).toBe(1100)
  })

  it('computes peak SCU on board', () => {
    expect(max.peakScu).toBe(10)
    expect(onBoardPerSegment(max.loads, 3)).toEqual([10, 10])
  })

  it('reports the oldest price age and aggregated flags', () => {
    expect(max.oldestPriceAgeDays).toBeCloseTo(12)
    expect(max.flags).toMatchObject({ stale: true, noStock: true, illegal: false })
    expect(max.warningCount).toBe(1)
  })

  it('computes capital required for an empty plan and with a single load', () => {
    expect(capitalRequired([], 3)).toBe(0)
    expect(capitalRequired(max.loads.slice(0, 1), 3)).toBe(1000)
  })

  it('has no age when every price age is unknown', () => {
    const r = run(
      {
        commodities: [commodity(1)],
        offers: [
          buyOffer(1, 1, 100, { dateModified: 0 }),
          sellOffer(1, 2, 120, { dateModified: 0 }),
        ],
      },
      { stops: [1, 2], freeScu: 5 },
    )
    expect(r.plans[0].oldestPriceAgeDays).toBeNull()
  })
})

describe('buildTimeline', () => {
  const { plans } = run(
    {
      commodities: [commodity(1, { name: 'Laranite' })],
      offers: [buyOffer(1, 1, 2810), sellOffer(1, 4, 3315)],
    },
    { stops: [1, 2, 3, 4], freeScu: 46, shipBoxSizes: [1, 2, 4, 8, 16] },
  )
  const timeline = buildTimeline(plans[0], [1, 2, 3, 4])

  it('lists a buy at the first stop, pass-through stops with SCU on board, and the sell', () => {
    expect(timeline.map((s) => s.passThrough)).toEqual([false, true, true, false])
    const buy = timeline[0].actions[0]
    expect(buy).toMatchObject({
      type: 'buy',
      qty: 46,
      commodityName: 'Laranite',
      unitPrice: 2810,
      total: 129260,
    })
    expect(buy.boxes).toEqual([
      { size: 16, count: 2 },
      { size: 8, count: 1 },
      { size: 4, count: 1 },
      { size: 2, count: 1 },
    ])
    expect(timeline[1]).toMatchObject({ onBoardArriving: 46, onBoardLeaving: 46, terminalId: 2 })
    const sell = timeline[3].actions[0]
    expect(sell).toMatchObject({ type: 'sell', unitPrice: 3315, total: 152490, profit: 23230 })
    expect(timeline[0].onBoardArriving).toBe(0)
    expect(timeline[3].onBoardLeaving).toBe(0)
  })

  it('puts sells before buys at the same stop', () => {
    const r = run(
      {
        commodities: [commodity(1), commodity(2)],
        offers: [
          buyOffer(1, 1, 100),
          sellOffer(1, 2, 120),
          buyOffer(2, 2, 100),
          sellOffer(2, 3, 120),
        ],
      },
      { stops: [1, 2, 3], freeScu: 10 },
    )
    expect(buildTimeline(r.plans[0], [1, 2, 3])[1].actions.map((a) => a.type)).toEqual([
      'sell',
      'buy',
    ])
  })
})
