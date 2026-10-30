import { describe, expect, it } from 'vitest'
import { DEFAULT_CALC_OPTIONS, generateCandidates, type CalcInput } from '../../calc'
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
import { buildMapIndexes, suggestStops, type SuggestOptions } from '.'

/**
 * Exactness check: on small random instances the search must find the same best route profit as
 * a naive enumeration of every valid insertion that is written independently (constraints from
 * §6.7 checked one by one, profit from the real candidate generation and a plain chain DP).
 */

const calc: Omit<CalcInput, 'stops'> = {
  freeScu: 12,
  shipBoxSizes: null,
  boxRange: { min: 1, max: 32 },
  smallHangar: false,
  options: DEFAULT_CALC_OPTIONS,
}
const commodities = [1, 2, 3].map((id) => commodity(id))

function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

interface Instance {
  nodes: TestNode[]
  pos: Map<string, [number, number]>
  fixed: number[]
  pool: number[]
  offers: ReturnType<typeof buyOffer>[]
  options: SuggestOptions
}

function instance(seed: number): Instance {
  const r = rng(seed)
  const nFixed = 3 + Math.floor(r() * 2)
  const nPool = 5
  const coords = new Map<string, [number, number]>()
  const nodes: TestNode[] = []
  const groups = ['planet:g1', 'planet:g2', null]
  for (let i = 0; i < nFixed + nPool; i++) {
    const fixed = i < nFixed
    const id = `station:${i}`
    const x = fixed ? i * 100 : r() * (nFixed - 1) * 100
    const y = fixed ? 0 : (r() - 0.5) * 120
    coords.set(id, [x, y])
    nodes.push({ id, x, terminals: [i + 1], group: fixed ? null : groups[Math.floor(r() * 3)] })
  }
  const offers: Instance['offers'] = []
  for (let t = 1; t <= nFixed + nPool; t++) {
    for (const c of commodities) {
      const roll = r()
      const price = 50 + Math.floor(r() * 100)
      if (roll < 0.35) offers.push(buyOffer(c.id, t, price))
      else if (roll < 0.7) offers.push(sellOffer(c.id, t, price))
    }
  }
  const perGap = 1 + Math.floor(r() * 2)
  return {
    nodes,
    pos: coords,
    fixed: Array.from({ length: nFixed }, (_, i) => i + 1),
    pool: Array.from({ length: nPool }, (_, i) => nFixed + i + 1),
    offers,
    options: {
      enabled: true,
      perGap,
      total: 1 + Math.floor(r() * 4),
      perGroup: 1 + Math.floor(r() * 2),
      detourPct: 100 + 10 * Math.floor(r() * 16),
    },
  }
}

const euclid = (nodes: TestNode[], pos: Map<string, [number, number]>) =>
  testMap(nodes, (a, b) => {
    const [ax, ay] = pos.get(a.id) ?? [a.x, 0]
    const [bx, by] = pos.get(b.id) ?? [b.x, 0]
    return Math.hypot(ax - bx, ay - by)
  })

let suggested = 0

describe('suggestStops is exact on small random instances', () => {
  it.each(Array.from({ length: 40 }, (_, i) => i + 1))('instance %i', (seed) => {
    const inst = instance(seed)
    const nFixed = inst.fixed.length
    const map = buildMapIndexes(euclid(inst.nodes, inst.pos))
    const terminals = inst.nodes.flatMap((n) => n.terminals).map((id) => terminal(id))
    const data = makeData({ commodities, terminals, offers: inst.offers })
    const { options } = inst

    const profitOf = (route: number[]) => {
      const { hauls } = generateCandidates(makeInput({ ...calc, stops: route }), data, NOW)
      const best = new Map<string, number>()
      for (const h of hauls) {
        const key = `${h.from}>${h.to}`
        best.set(key, Math.max(best.get(key) ?? 0, h.profit))
      }
      const f = new Array<number>(route.length).fill(0)
      for (let k = 1; k < route.length; k++) {
        f[k] = f[k - 1]
        for (let i = 0; i < k; i++) f[k] = Math.max(f[k], f[i] + (best.get(`${i}>${k}`) ?? 0))
      }
      return f[route.length - 1]
    }
    const dist = (a: number, b: number) => map.distance(a, b) as number
    const groupOf = (id: number) => {
      const node = map.nodeOfTerminal(id)
      return node ? map.groupOf(node) : `t${id}`
    }

    // every ordered selection of up to `max` distinct pool terminals
    const sequences = (max: number): number[][] => {
      const out: number[][] = [[]]
      const extend = (cur: number[]) => {
        if (cur.length === max) return
        for (const t of inst.pool) {
          if (cur.includes(t)) continue
          out.push([...cur, t])
          extend([...cur, t])
        }
      }
      extend([])
      return out
    }
    const gapOptions = (g: number) =>
      sequences(options.perGap).filter((seq) => {
        const a = inst.fixed[g]
        const b = inst.fixed[g + 1]
        if (seq.length === 0) return true
        const path = [a, ...seq, b]
        let total = 0
        for (let i = 1; i < path.length; i++) total += dist(path[i - 1], path[i])
        if (total > (dist(a, b) * options.detourPct) / 100 + 1e-9) return false
        for (let i = 1; i < path.length; i++) {
          const u = path[i - 1]
          const v = path[i]
          if (groupOf(u) !== groupOf(v) && !(dist(v, b) < dist(u, b))) return false
        }
        return true
      })

    const perGap = Array.from({ length: nFixed - 1 }, (_, g) => gapOptions(g))
    const base = profitOf(inst.fixed)
    let best = base
    const walk = (g: number, chosen: number[][]) => {
      if (g === perGap.length) {
        const dynamic = chosen.flat()
        if (new Set(dynamic).size !== dynamic.length) return
        if (dynamic.length > options.total || nFixed + dynamic.length > 10) return
        const perGroup = new Map<string, number>()
        for (const t of dynamic) perGroup.set(groupOf(t), (perGroup.get(groupOf(t)) ?? 0) + 1)
        if ([...perGroup.values()].some((c) => c > options.perGroup)) return
        const route = inst.fixed.flatMap((id, i) => [id, ...(chosen[i] ?? [])])
        best = Math.max(best, profitOf(route))
        return
      }
      for (const seq of perGap[g]) walk(g + 1, [...chosen, seq])
    }
    walk(0, [])

    const outcome = suggestStops(
      { fixed: inst.fixed, calc, options, dismissed: [], nowSec: NOW },
      { terminals, data, map },
    )
    if (best > base) {
      expect(outcome.kind).toBe('ok')
      suggested++
      if (outcome.kind === 'ok') {
        expect(outcome.result.profitAfter).toBe(best)
        expect(outcome.result.profitBefore).toBe(base)
        expect(profitOf(outcome.result.route)).toBe(best)
        expect(outcome.result.stops.length).toBeLessThanOrEqual(options.total)
      }
    } else {
      expect(outcome.kind).toBe('none')
    }
  })

  it('the instances exercise the search, not only the "no suggestion" path', () => {
    expect(suggested).toBeGreaterThanOrEqual(10)
  })
})

let suggestedWithAccepted = 0

describe('suggestStops is exact with accepted dynamic stops already in the route', () => {
  it.each(Array.from({ length: 40 }, (_, i) => i + 101))('instance %i', (seed) => {
    const inst = instance(seed)
    const r = rng(seed * 7 + 3)
    const nFixed = inst.fixed.length
    const acceptedTerminal = inst.pool[Math.floor(r() * inst.pool.length)]
    // gap g, or before the first (-1) / after the last fixed stop (nFixed - 1)
    const acceptedAfter = Math.floor(r() * (nFixed + 1)) - 1
    const map = buildMapIndexes(euclid(inst.nodes, inst.pos))
    const terminals = inst.nodes.flatMap((n) => n.terminals).map((id) => terminal(id))
    const data = makeData({ commodities, terminals, offers: inst.offers })
    const { options } = inst
    const pool = inst.pool.filter((t) => t !== acceptedTerminal)

    const profitOf = (route: number[]) => {
      const { hauls } = generateCandidates(makeInput({ ...calc, stops: route }), data, NOW)
      const best = new Map<string, number>()
      for (const h of hauls) {
        const key = `${h.from}>${h.to}`
        best.set(key, Math.max(best.get(key) ?? 0, h.profit))
      }
      const f = new Array<number>(route.length).fill(0)
      for (let k = 1; k < route.length; k++) {
        f[k] = f[k - 1]
        for (let i = 0; i < k; i++) f[k] = Math.max(f[k], f[i] + (best.get(`${i}>${k}`) ?? 0))
      }
      return f[route.length - 1]
    }
    const dist = (a: number, b: number) => map.distance(a, b) as number
    const groupOf = (id: number) => {
      const node = map.nodeOfTerminal(id)
      return node ? map.groupOf(node) : `t${id}`
    }
    const sequences = (max: number): number[][] => {
      const out: number[][] = [[]]
      const extend = (cur: number[]) => {
        if (cur.length === max) return
        for (const t of pool) {
          if (cur.includes(t)) continue
          out.push([...cur, t])
          extend([...cur, t])
        }
      }
      extend([])
      return out
    }
    const insertAt = (seq: number[], at: number, id: number) => [
      ...seq.slice(0, at),
      id,
      ...seq.slice(at),
    ]

    // every full stop sequence (new stops + the accepted one) of gap g that is allowed
    const gapOptions = (g: number): { seq: number[]; fresh: number[] }[] => {
      const a = inst.fixed[g]
      const b = inst.fixed[g + 1]
      const hasAccepted = acceptedAfter === g
      const room = options.perGap - (hasAccepted ? 1 : 0)
      const out: { seq: number[]; fresh: number[] }[] = []
      for (const fresh of sequences(Math.max(0, room))) {
        const placements = hasAccepted
          ? Array.from({ length: fresh.length + 1 }, (_, at) =>
              insertAt(fresh, at, acceptedTerminal),
            )
          : [fresh]
        for (const seq of placements) {
          if (fresh.length > 0) {
            const path = [a, ...seq, b]
            let total = 0
            for (let i = 1; i < path.length; i++) total += dist(path[i - 1], path[i])
            if (total > (dist(a, b) * options.detourPct) / 100 + 1e-9) continue
            let forward = true
            for (let i = 1; i < path.length; i++) {
              const u = path[i - 1]
              const v = path[i]
              if (groupOf(u) !== groupOf(v) && !(dist(v, b) < dist(u, b))) forward = false
            }
            if (!forward) continue
          }
          out.push({ seq, fresh })
        }
      }
      return out
    }

    const perGap = Array.from({ length: nFixed - 1 }, (_, g) => gapOptions(g))
    const head = acceptedAfter === -1 ? [acceptedTerminal] : []
    const tail = acceptedAfter === nFixed - 1 ? [acceptedTerminal] : []
    const current = [
      ...head,
      ...inst.fixed.flatMap((id, i) => [
        id,
        ...(acceptedAfter === i && i < nFixed - 1 ? [acceptedTerminal] : []),
      ]),
      ...tail,
    ]
    const base = profitOf(current)
    let best = base
    const walk = (g: number, chosen: { seq: number[]; fresh: number[] }[]) => {
      if (g === perGap.length) {
        const fresh = chosen.flatMap((c) => c.fresh)
        if (new Set(fresh).size !== fresh.length) return
        const dynamic = [...fresh, acceptedTerminal]
        if (dynamic.length > options.total || nFixed + dynamic.length > 10) return
        const perGroup = new Map<string, number>()
        for (const t of dynamic) perGroup.set(groupOf(t), (perGroup.get(groupOf(t)) ?? 0) + 1)
        if ([...perGroup.values()].some((c) => c > options.perGroup)) return
        const route = [
          ...head,
          ...inst.fixed.flatMap((id, i) => [id, ...(chosen[i]?.seq ?? [])]),
          ...tail,
        ]
        best = Math.max(best, profitOf(route))
        return
      }
      for (const option of perGap[g]) walk(g + 1, [...chosen, option])
    }
    walk(0, [])

    const outcome = suggestStops(
      {
        fixed: inst.fixed,
        accepted: [{ terminalId: acceptedTerminal, afterFixed: acceptedAfter }],
        calc,
        options,
        dismissed: [],
        nowSec: NOW,
      },
      { terminals, data, map },
    )
    if (best > base) {
      expect(outcome.kind).toBe('ok')
      suggestedWithAccepted++
      if (outcome.kind === 'ok') {
        expect(outcome.result.profitAfter).toBe(best)
        expect(outcome.result.profitBefore).toBe(base)
        expect(profitOf(outcome.result.route)).toBe(best)
        expect(outcome.result.route).toContain(acceptedTerminal)
        expect(outcome.result.stops.length + 1).toBeLessThanOrEqual(options.total)
      }
    } else {
      expect(outcome.kind).toBe('none')
    }
  })

  it('the instances exercise the search, not only the "no suggestion" path', () => {
    expect(suggestedWithAccepted).toBeGreaterThanOrEqual(5)
  })
})
