import { describe, expect, it } from 'vitest'
import { DEFAULT_CALC_OPTIONS, generateCandidates, type CalcInput } from '../../calc'
import { pairProfits } from '../../calc/pairProfits'
import { testMap, type TestNode } from '../../test-utils/mapFixture'
import {
  NOW,
  buyOffer,
  commodity,
  makeData,
  makeInput,
  sellOffer,
  terminal,
} from '../../test-utils/calcFixtures'
import type { Terminal } from '../../domain/types'
import { buildMapIndexes, candidateTerminals, suggestStops } from '.'
import {
  DEFAULT_SUGGEST_OPTIONS,
  normalizeSuggestOptions,
  type SuggestOptions,
  type SuggestOutcome,
  type SuggestResult,
} from './types'

type Offers = Parameters<typeof makeData>[0]['offers']

const calcBase: Omit<CalcInput, 'stops'> = {
  freeScu: 10,
  shipBoxSizes: null,
  boxRange: { min: 1, max: 32 },
  options: DEFAULT_CALC_OPTIONS,
}

const OPTS: SuggestOptions = { ...DEFAULT_SUGGEST_OPTIONS, enabled: true }

interface Scenario {
  nodes: TestNode[]
  d?: Parameters<typeof testMap>[1]
  terminals?: Terminal[]
  offers: Offers
  fixed: number[]
  options?: Partial<SuggestOptions>
  dismissed?: number[]
  calc?: Partial<Omit<CalcInput, 'stops'>>
}

const quartz = commodity(1, { name: 'Quartz' })
const waste = commodity(2, { name: 'Waste' })
const scrap = commodity(3, { name: 'Scrap' })
const commodities = [quartz, waste, scrap]

function run(s: Scenario): SuggestOutcome {
  const terminals = s.terminals ?? s.nodes.flatMap((n) => n.terminals).map((id) => terminal(id))
  const map = buildMapIndexes(testMap(s.nodes, s.d))
  const data = makeData({ commodities, terminals, offers: s.offers })
  return suggestStops(
    {
      fixed: s.fixed,
      calc: { ...calcBase, ...s.calc },
      options: { ...OPTS, ...s.options },
      dismissed: s.dismissed ?? [],
      nowSec: NOW,
    },
    { terminals, data, map },
  )
}

const ok = (outcome: SuggestOutcome): SuggestResult => {
  if (outcome.kind !== 'ok') throw new Error(`expected a suggestion, got ${outcome.kind}`)
  return outcome.result
}
const stopIds = (outcome: SuggestOutcome) => ok(outcome).stops.map((s) => s.terminalId)

// A (t1) at 0 and B (t2) at 100 are fixed; X (t3) at 50 buys Quartz that B buys.
const A: TestNode = { id: 'station:A', x: 0, terminals: [1] }
const B: TestNode = { id: 'station:B', x: 100, terminals: [2] }
const X: TestNode = { id: 'station:X', x: 50, terminals: [3] }
const quartzXtoB: Offers = [buyOffer(1, 3, 100), sellOffer(1, 2, 150)] // 10 SCU × 50 = 500

describe('suggestStops: the basic suggestion', () => {
  it('suggests a stop that raises the route profit and reports before/after', () => {
    const outcome = run({ nodes: [A, X, B], offers: quartzXtoB, fixed: [1, 2] })
    const r = ok(outcome)
    expect(r.stops).toHaveLength(1)
    expect(r.stops[0]).toMatchObject({ terminalId: 3, gapIndex: 0, position: 0, routeIndex: 1 })
    expect(r.profitBefore).toBe(0)
    expect(r.profitAfter).toBe(500)
    expect(r.route).toEqual([1, 3, 2])
    expect(r.distanceBefore).toBe(100)
    expect(r.distanceAfter).toBe(100)
    expect(r.legs).toEqual([{ from: 1, to: 2, commodityName: 'Quartz', profit: 500 }])
    expect(r.stops[0].role).toEqual({
      buy: { commodityName: 'Quartz', toTerminalId: 2, toIndex: 2 },
    })
    expect(r.bestFound).toBe(false)
  })

  it('describes the sell role of a stop too', () => {
    // A buys Waste, X (on the way) buys it
    const outcome = run({
      nodes: [A, X, B],
      offers: [buyOffer(2, 1, 100), sellOffer(2, 3, 130)],
      fixed: [1, 2],
    })
    expect(ok(outcome).stops[0].role).toEqual({
      sell: { commodityName: 'Waste', fromTerminalId: 1, fromIndex: 0 },
    })
  })

  it('suggests nothing when no insertion raises the profit', () => {
    // A→B already earns 500; X adds nothing
    const outcome = run({
      nodes: [A, X, B],
      offers: [buyOffer(1, 1, 100), sellOffer(1, 2, 150), buyOffer(2, 3, 100), sellOffer(2, 3, 90)],
      fixed: [1, 2],
    })
    expect(outcome).toEqual({ kind: 'none', bestFound: false })
  })

  it('suggests nothing when the stop has no trade', () => {
    expect(run({ nodes: [A, X, B], offers: [], fixed: [1, 2] }).kind).toBe('none')
  })

  it('reports why it is unavailable', () => {
    expect(run({ nodes: [A, X, B], offers: quartzXtoB, fixed: [1] })).toEqual({
      kind: 'unavailable',
      reason: 'Add at least two stops first.',
    })
  })

  it('never suggests when the option leaves no room (per gap 0)', () => {
    expect(
      run({ nodes: [A, X, B], offers: quartzXtoB, fixed: [1, 2], options: { perGap: 0 } }).kind,
    ).toBe('none')
  })
})

describe('detour limit', () => {
  // X is off the line: d(A,X) + d(X,B) is set explicitly; d(A,B) = 100
  const detour = (via: number) =>
    run({
      nodes: [A, X, B],
      d: (a, b) =>
        a.id === 'station:X' && b.id === 'station:B'
          ? via / 2
          : a.id === 'station:A' && b.id === 'station:X'
            ? via / 2
            : undefined,
      offers: quartzXtoB,
      fixed: [1, 2],
    })

  it('allows a detour of exactly p (150 %)', () => {
    expect(detour(150).kind).toBe('ok')
  })

  it('rejects a detour just above p', () => {
    expect(detour(151).kind).toBe('none')
  })

  it('follows a changed p', () => {
    // A → X is 120, X → B is 80 (still closer to B): a detour of 200 %
    const around = (pct: number) =>
      run({
        nodes: [A, X, B],
        d: (a, b) =>
          a.id === 'station:A' && b.id === 'station:X'
            ? 120
            : a.id === 'station:X' && b.id === 'station:B'
              ? 80
              : undefined,
        offers: quartzXtoB,
        fixed: [1, 2],
        options: { detourPct: pct },
      })
    expect(around(200).kind).toBe('ok')
    expect(around(190).kind).toBe('none')
  })

  it('sums the detour over several stops of one gap', () => {
    // Quartz X1→X2 and Waste X2→B only pay when both stops are inserted
    const x1: TestNode = { id: 'station:X1', x: 30, terminals: [3] }
    const x2: TestNode = { id: 'station:X2', x: 60, terminals: [4] }
    const offers: Offers = [
      buyOffer(1, 3, 100),
      sellOffer(1, 4, 150),
      buyOffer(2, 4, 100),
      sellOffer(2, 2, 160),
    ]
    const both = run({ nodes: [A, x1, x2, B], offers, fixed: [1, 2], options: { perGap: 2 } })
    expect(stopIds(both)).toEqual([3, 4])
    expect(ok(both).profitAfter).toBe(500 + 600)
    // with the second stop behind B the pair needs 30 + 110 + 40 = 180 > 150 % of the gap
    const far: TestNode = { id: 'station:far', x: 140, terminals: [4] }
    expect(
      run({ nodes: [A, x1, far, B], offers, fixed: [1, 2], options: { perGap: 2 } }).kind,
    ).toBe('none')
  })
})

describe('forward rule', () => {
  const behind: TestNode = { id: 'station:behind', x: -40, terminals: [3] }
  const wide: Partial<SuggestOptions> = { detourPct: 300 }

  it('rejects a stop in another planetary group that moves away from the next fixed stop', () => {
    // d(A,behind) + d(behind,B) = 40 + 140 = 180 ≤ 300 % but d(behind,B) = 140 ≥ d(A,B) = 100
    expect(
      run({ nodes: [behind, A, B], offers: quartzXtoB, fixed: [1, 2], options: wide }).kind,
    ).toBe('none')
  })

  it('allows the same position inside one planetary group (planet → moon → station)', () => {
    const planet: TestNode = { id: 'planet:P', x: 0, group: 'planet:P', terminals: [1] }
    const moon: TestNode = { id: 'moon:M', x: -40, group: 'planet:P', terminals: [3] }
    const out = run({ nodes: [moon, planet, B], offers: quartzXtoB, fixed: [1, 2], options: wide })
    expect(stopIds(out)).toEqual([3])
  })

  it('allows planet → moon → station in any order inside the group', () => {
    const planet: TestNode = { id: 'planet:P', x: 0, group: 'planet:P', terminals: [1] }
    const moon: TestNode = { id: 'moon:M', x: -30, group: 'planet:P', terminals: [3] }
    const station: TestNode = { id: 'station:S', x: -10, group: 'planet:P', terminals: [4] }
    const offers: Offers = [
      buyOffer(1, 3, 100),
      sellOffer(1, 4, 150),
      buyOffer(2, 4, 100),
      sellOffer(2, 2, 160),
    ]
    const out = run({
      nodes: [moon, station, planet, B],
      offers,
      fixed: [1, 2],
      options: { ...wide, perGap: 2, perGroup: 2 },
    })
    expect(stopIds(out)).toEqual([3, 4]) // moon, then the station nearer to the planet
  })
})

describe('limits', () => {
  const x1: TestNode = { id: 'station:X1', x: 40, terminals: [3] }
  const x2: TestNode = { id: 'station:X2', x: 60, terminals: [4] }
  const chain: Offers = [
    buyOffer(1, 3, 100),
    sellOffer(1, 4, 140), // X1 → X2: 10 × 40 = 400
    buyOffer(2, 4, 100),
    sellOffer(2, 2, 150), // X2 → B: 10 × 50 = 500
  ]

  it('allows two stops in one gap when the per-gap limit is 2', () => {
    const out = run({ nodes: [A, x1, x2, B], offers: chain, fixed: [1, 2], options: { perGap: 2 } })
    expect(stopIds(out)).toEqual([3, 4])
    expect(ok(out).profitAfter).toBe(900)
  })

  it('keeps one stop per gap by default', () => {
    const out = run({ nodes: [A, x1, x2, B], offers: chain, fixed: [1, 2] })
    expect(stopIds(out)).toHaveLength(1)
    expect(ok(out).profitAfter).toBe(500) // X2 → B alone
  })

  it('allows only one dynamic stop per planetary group (terminal stops count, fixed stops do not)', () => {
    const g1: TestNode = { ...x1, id: 'moon:M1', group: 'planet:P' }
    const g2: TestNode = { ...x2, id: 'station:S1', group: 'planet:P' }
    const limited = run({
      nodes: [A, g1, g2, B],
      offers: chain,
      fixed: [1, 2],
      options: { perGap: 2, perGroup: 1 },
    })
    expect(stopIds(limited)).toHaveLength(1)
    const free = run({
      nodes: [A, g1, g2, B],
      offers: chain,
      fixed: [1, 2],
      options: { perGap: 2, perGroup: 2 },
    })
    expect(stopIds(free)).toEqual([3, 4])
  })

  it('does not count a fixed stop towards the per-group limit', () => {
    const planet: TestNode = { ...A, id: 'planet:P', group: 'planet:P' }
    const moon: TestNode = { ...x1, id: 'moon:M1', group: 'planet:P' }
    const out = run({
      nodes: [planet, moon, B],
      offers: [buyOffer(1, 3, 100), sellOffer(1, 2, 150)],
      fixed: [1, 2],
      options: { perGroup: 1 },
    })
    expect(stopIds(out)).toEqual([3])
  })

  it('honours the total limit', () => {
    // three gaps, each with a profitable stop; total limit 2
    const nodes: TestNode[] = [
      { id: 'station:F0', x: 0, terminals: [1] },
      { id: 'station:G0', x: 50, terminals: [11] },
      { id: 'station:F1', x: 100, terminals: [2] },
      { id: 'station:G1', x: 150, terminals: [12] },
      { id: 'station:F2', x: 200, terminals: [3] },
      { id: 'station:G2', x: 250, terminals: [13] },
      { id: 'station:F3', x: 300, terminals: [4] },
    ]
    const offers: Offers = [
      buyOffer(1, 11, 100),
      sellOffer(1, 2, 150), // 500
      buyOffer(2, 12, 100),
      sellOffer(2, 3, 160), // 600
      buyOffer(3, 13, 100),
      sellOffer(3, 4, 170), // 700
    ]
    const base = { nodes, offers, fixed: [1, 2, 3, 4] }
    expect(stopIds(run({ ...base, options: { total: 3 } }))).toEqual([11, 12, 13])
    const two = run({ ...base, options: { total: 2 } })
    expect(stopIds(two)).toEqual([12, 13])
    expect(ok(two).profitAfter).toBe(1300)
  })

  it('never exceeds the 10-stop route limit', () => {
    const nodes: TestNode[] = []
    const offers: Offers = []
    const fixed: number[] = []
    for (let i = 0; i < 9; i++) {
      nodes.push({ id: `station:F${i}`, x: i * 100, terminals: [i + 1] })
      fixed.push(i + 1)
      nodes.push({ id: `station:G${i}`, x: i * 100 + 50, terminals: [i + 21] })
      offers.push(buyOffer(1, i + 21, 100), sellOffer(1, i + 2, 150 + i))
    }
    const out = run({ nodes, offers, fixed: fixed.slice(0, 9), options: { total: 8, perGap: 1 } })
    expect(ok(out).route.length).toBeLessThanOrEqual(10)
    expect(ok(out).stops).toHaveLength(1) // 9 fixed + 1
  })
})

describe('candidates', () => {
  it('never suggests a city terminal', () => {
    const terminals = [terminal(1), terminal(2), terminal(3, { cityName: 'Area 18' })]
    expect(run({ nodes: [A, X, B], terminals, offers: quartzXtoB, fixed: [1, 2] }).kind).toBe(
      'none',
    )
  })

  it('never suggests a star system the fixed stops do not use', () => {
    const other: TestNode = { ...X, system: 2 }
    expect(run({ nodes: [A, other, B], offers: quartzXtoB, fixed: [1, 2] }).kind).toBe('none')
  })

  it('never suggests unavailable, invisible, dismissed or terminals without a map node', () => {
    const hidden = (over: Partial<Terminal>) => [terminal(1), terminal(2), terminal(3, over)]
    const base = { nodes: [A, X, B], offers: quartzXtoB, fixed: [1, 2] }
    expect(run({ ...base, terminals: hidden({ isAvailableLive: false }) }).kind).toBe('none')
    expect(run({ ...base, terminals: hidden({ isVisible: false }) }).kind).toBe('none')
    expect(run({ ...base, dismissed: [3] }).kind).toBe('none')
    // t3 has offers but no node in the map
    expect(
      run({ nodes: [A, B], terminals: hidden({}), offers: quartzXtoB, fixed: [1, 2] }).kind,
    ).toBe('none')
  })

  it('never suggests a fixed stop and needs an eligible commodity at the terminal', () => {
    const terminals = [terminal(1), terminal(2), terminal(3)]
    const map = buildMapIndexes(testMap([A, X, B]))
    const data = makeData({
      commodities: [commodity(1, { isRaw: true })],
      terminals,
      offers: [buyOffer(1, 3, 100)],
    })
    expect(candidateTerminals(terminals, [1, 2], [], map, data)).toEqual([])
    const ok2 = makeData({ commodities, terminals, offers: [buyOffer(1, 3, 100)] })
    expect(candidateTerminals(terminals, [1, 2], [], map, ok2).map((t) => t.id)).toEqual([3])
    expect(candidateTerminals(terminals, [1, 3], [], map, ok2)).toEqual([])
    const sellOnly = makeData({ commodities, terminals, offers: [sellOffer(1, 3, 100)] })
    expect(candidateTerminals(terminals, [1, 2], [], map, sellOnly).map((t) => t.id)).toEqual([3])
  })

  it('cannot insert into a gap whose fixed stop has no map node', () => {
    // B (t2) has no node: the gap A→B stays empty, but A and the other gap work
    const nodes: TestNode[] = [A, X, { id: 'station:C', x: 200, terminals: [5] }]
    const out = run({
      nodes,
      terminals: [1, 2, 3, 5].map((id) => terminal(id)),
      offers: quartzXtoB,
      fixed: [1, 2, 5],
    })
    expect(out.kind).toBe('none')
  })

  it('is unavailable when no fixed stop has a map node', () => {
    const out = run({
      nodes: [X],
      terminals: [1, 2, 3].map((id) => terminal(id)),
      offers: quartzXtoB,
      fixed: [1, 2],
    })
    expect(out).toEqual({
      kind: 'unavailable',
      reason: 'None of the stops has a position on the map.',
    })
  })
})

describe('trades that span a fixed stop', () => {
  it('buys at X before B and sells at Y after B', () => {
    const nodes: TestNode[] = [
      { id: 'station:A', x: 0, terminals: [1] },
      { id: 'station:X', x: 50, terminals: [3] },
      { id: 'station:B', x: 100, terminals: [2] },
      { id: 'station:Y', x: 150, terminals: [4] },
      { id: 'station:C', x: 200, terminals: [5] },
    ]
    const out = run({
      nodes,
      terminals: [1, 2, 3, 4, 5].map((id) => terminal(id)),
      offers: [buyOffer(1, 3, 100), sellOffer(1, 4, 180)], // X → Y: 800
      fixed: [1, 2, 5],
    })
    const r = ok(out)
    expect(r.route).toEqual([1, 3, 2, 4, 5])
    expect(r.stops.map((s) => [s.terminalId, s.gapIndex, s.position])).toEqual([
      [3, 0, 0],
      [4, 1, 0],
    ])
    expect(r.legs).toEqual([{ from: 1, to: 3, commodityName: 'Quartz', profit: 800 }])
    expect(r.profitBefore).toBe(0)
    expect(r.profitAfter).toBe(800)
    expect(r.stops[0].role.buy).toMatchObject({ toTerminalId: 4, toIndex: 3 })
    expect(r.stops[1].role.sell).toMatchObject({ fromTerminalId: 3, fromIndex: 1 })
  })
})

describe('unused dynamic stops are dropped', () => {
  it('removes a stop the chosen chain neither buys nor sells at', () => {
    // via Z the route A → X → Z → B is shorter than A → X → B (a shortcut), so the search
    // prefers it at equal profit; Z carries nothing in the chain and is dropped again
    const z: TestNode = { id: 'station:Z', x: 70, terminals: [4] }
    const out = run({
      nodes: [A, X, z, B],
      d: (a, b) => {
        const k = `${a.id}>${b.id}`
        if (k === 'station:X>station:Z') return 2
        if (k === 'station:Z>station:B') return 2
        if (k === 'station:X>station:B') return 50
        return undefined
      },
      offers: [...quartzXtoB, buyOffer(2, 4, 100), sellOffer(2, 2, 105)], // Z → B pays only 50
      fixed: [1, 2],
      options: { perGap: 2, perGroup: 2 },
    })
    // Z → B (50) is part of no better chain than X → B (500): Z is on no leg
    expect(stopIds(out)).toEqual([3])
    expect(ok(out).route).toEqual([1, 3, 2])
  })
})

describe('deterministic tie-breaks', () => {
  it('prefers the shorter total distance at equal profit', () => {
    const near: TestNode = { id: 'station:near', x: 50, terminals: [4] }
    const out = run({
      nodes: [A, X, near, B],
      d: (a, b) =>
        a.id === 'station:X' || b.id === 'station:X'
          ? a.id === 'station:A' || b.id === 'station:B'
            ? 60
            : undefined
          : undefined,
      offers: [...quartzXtoB, buyOffer(1, 4, 100)],
      fixed: [1, 2],
    })
    // X is 60 + 60 = 120 away (detour), `near` 50 + 50 = 100: both earn 500
    expect(stopIds(out)).toEqual([4])
  })

  it('prefers the smallest terminal id when everything else is equal', () => {
    const twin: TestNode = { id: 'station:twin', x: 50, terminals: [4] }
    const offers: Offers = [...quartzXtoB, buyOffer(1, 4, 100)]
    const out = run({ nodes: [A, X, twin, B], offers, fixed: [1, 2] })
    expect(stopIds(out)).toEqual([3])
    const reversed = run({ nodes: [A, twin, X, B], offers, fixed: [1, 2] })
    expect(stopIds(reversed)).toEqual([3])
  })

  it('gives the same suggestion for the same inputs', () => {
    const args: Scenario = { nodes: [A, X, B], offers: quartzXtoB, fixed: [1, 2] }
    expect(run(args)).toEqual(run(args))
  })

  it('prefers fewer dynamic stops at equal profit and distance', () => {
    const a: TestNode = { id: 'station:X1', x: 30, terminals: [3] }
    const b: TestNode = { id: 'station:X2', x: 60, terminals: [4] }
    // one stop (X1 → B: 500) is as good as two (X1 and X2 on the way, X2 useless)
    const out = run({
      nodes: [A, a, b, B],
      offers: [buyOffer(1, 3, 100), sellOffer(1, 2, 150), buyOffer(2, 4, 10), sellOffer(2, 2, 11)],
      fixed: [1, 2],
      options: { perGap: 2 },
    })
    expect(stopIds(out)).toEqual([3]) // X2 adds nothing, so only X1 is inserted
    expect(ok(out).profitAfter).toBe(500)
  })
})

describe('search budget', () => {
  it('flags "best found" when the time budget is hit on a big search', () => {
    // 3 gaps × 15 candidates: thousands of search nodes, so the clock is checked
    const nodes: TestNode[] = [0, 1, 2, 3].map((i) => ({
      id: `station:F${i}`,
      x: i * 100,
      terminals: [i + 1],
    }))
    const offers: Offers = [sellOffer(1, 4, 200)]
    for (let g = 0; g < 3; g++) {
      for (let k = 0; k < 15; k++) {
        const id = 100 + g * 20 + k
        nodes.push({ id: `station:C${id}`, x: g * 100 + 20 + k * 4, terminals: [id] })
        offers.push(buyOffer(1, id, 100 + k))
      }
    }
    const terminals = nodes.flatMap((n) => n.terminals).map((id) => terminal(id))
    const map = buildMapIndexes(testMap(nodes))
    const data = makeData({ commodities, terminals, offers })
    const outcome = suggestStops(
      {
        fixed: [1, 2, 3, 4],
        calc: calcBase,
        options: { ...OPTS, total: 8 },
        dismissed: [],
        nowSec: NOW,
        budgetMs: -1, // exhausted at the first clock check
      },
      { terminals, data, map },
    )
    expect(
      outcome.kind === 'ok'
        ? outcome.result.bestFound
        : outcome.kind === 'none' && outcome.bestFound,
    ).toBe(true)
  })
})

describe('pairProfits', () => {
  it('equals the best haul profit of the candidate generation for every ordered pair', () => {
    const terminals = [1, 2, 3, 4].map((id) =>
      terminal(id, { maxContainerSize: id === 4 ? 2 : 32 }),
    )
    const offers: Offers = [
      buyOffer(1, 1, 100),
      sellOffer(1, 2, 150),
      sellOffer(1, 3, 130),
      buyOffer(2, 2, 90),
      sellOffer(2, 1, 120),
      sellOffer(2, 4, 200, { containerSizes: [] }),
      buyOffer(3, 3, 50, { containerSizes: [8, 16] }),
      sellOffer(3, 4, 80),
      sellOffer(3, 1, 70, { dateModified: NOW - 40 * 86400 }),
    ]
    const data = makeData({ commodities, terminals, offers })
    for (const calc of [
      calcBase,
      { ...calcBase, boxRange: { min: 4, max: 16 }, freeScu: 46 },
      { ...calcBase, options: { ...DEFAULT_CALC_OPTIONS, maxPriceAgeDays: 7 } },
    ]) {
      const ids = [1, 2, 3, 4]
      const pp = pairProfits(ids, calc, data, NOW)
      for (let a = 0; a < 4; a++) {
        for (let b = 0; b < 4; b++) {
          if (a === b) continue
          const { hauls } = generateCandidates(
            makeInput({ ...calc, stops: [ids[a], ids[b]] }),
            data,
            NOW,
          )
          const best = Math.max(0, ...hauls.map((h) => h.profit))
          expect(pp.profit[a * 4 + b], `${ids[a]}→${ids[b]}`).toBe(best)
        }
      }
    }
  })

  it('returns zeros when there is no free space', () => {
    const data = makeData({
      commodities,
      terminals: [terminal(1), terminal(2)],
      offers: quartzXtoB,
    })
    const pp = pairProfits([1, 2], { ...calcBase, freeScu: 0 }, data, NOW)
    expect([...pp.profit]).toEqual([0, 0, 0, 0])
  })
})

describe('options', () => {
  it('clamps persisted options into their documented ranges', () => {
    expect(
      normalizeSuggestOptions({ enabled: true, perGap: 9, total: 0, perGroup: 7, detourPct: 333 }),
    ).toEqual({ enabled: true, perGap: 3, total: 1, perGroup: 3, detourPct: 300 })
    expect(normalizeSuggestOptions({ detourPct: 94, perGap: -2 })).toMatchObject({
      detourPct: 100,
      perGap: 0,
    })
    expect(normalizeSuggestOptions({})).toEqual(DEFAULT_SUGGEST_OPTIONS)
    expect(normalizeSuggestOptions({ detourPct: 155 }).detourPct).toBe(160)
  })
})
