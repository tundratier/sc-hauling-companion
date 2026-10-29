import type { CalcData, StopoverLeg } from '../../calc'
import { pairProfits } from '../../calc/pairProfits'
import type { Terminal } from '../../domain/types'
import { candidateTerminals } from './candidates'
import type { MapIndexes } from './map'
import {
  MAX_ROUTE_STOPS,
  type StopOrigin,
  type SuggestOutcome,
  type SuggestRequest,
  type SuggestedRole,
  type SuggestedStop,
} from './types'

export interface SuggestEnv {
  terminals: Terminal[]
  data: CalcData
  map: MapIndexes
}

const EPS = 1e-9
export const DEFAULT_BUDGET_MS = 2000

interface ChainLeg {
  from: number
  to: number
  profit: number
}

interface Chain {
  profit: number
  legs: ChainLeg[]
}

/**
 * Longest path over an ordered stop list: `f(k) = max(f(k−1), max_{i<k} f(i) + w(i, k))` (the
 * §6.6 interval DP in its linear form). `w` is the best haul profit between two stops. Ties keep
 * the shorter chain (fewer legs), so the result is deterministic.
 */
function bestChain(seq: number[], weight: (a: number, b: number) => number): Chain {
  const m = seq.length
  const f = new Float64Array(m)
  const back = new Int32Array(m).fill(-1)
  for (let k = 1; k < m; k++) {
    f[k] = f[k - 1]
    for (let i = 0; i < k; i++) {
      const p = f[i] + weight(seq[i], seq[k])
      if (p > f[k]) {
        f[k] = p
        back[k] = i
      }
    }
  }
  const legs: ChainLeg[] = []
  for (let k = m - 1; k > 0;) {
    if (back[k] < 0) {
      k--
    } else {
      const i = back[k]
      legs.unshift({ from: i, to: k, profit: weight(seq[i], seq[k]) })
      k = i
    }
  }
  return { profit: m > 0 ? f[m - 1] : 0, legs }
}

/** Role of a stop in the combined route: entered, accepted earlier, or newly suggested. */
const FIXED = 0
const ACCEPTED = 1
const NEW = 2

interface Best {
  p: number
  dist: number
  dyn: number
  seq: number[]
  kind: number[]
}

/**
 * Add profitable stops (§6.7): the best insertion of dynamic stops between the fixed stops.
 *
 * Accepted dynamic stops (`req.accepted`) are part of the route already: they are never moved,
 * removed or replaced, but they count towards every limit and sit in their gap's stop sequence
 * for the detour and forward rules. Only the remaining budget is filled with new stops.
 *
 * Exact search (depth-first over the gaps) for the options given. Pair profits and distances are
 * precomputed once, and the route profit of a stop list is evaluated incrementally while the
 * list is extended, so a leaf costs O(route length). Candidates are pruned per gap by the
 * single-stop detour rule before the search; the forward rule, the per-gap / total / per-group
 * limits and the 10-stop cap are enforced while descending. Deterministic: ties are broken by
 * shorter total distance, fewer dynamic stops, then the smallest list of terminal ids.
 */
export function suggestStops(req: SuggestRequest, env: SuggestEnv): SuggestOutcome {
  const { fixed, options } = req
  const n = fixed.length
  const accepted = (req.accepted ?? []).map((a) => ({
    terminalId: a.terminalId,
    afterFixed: Math.min(n - 1, Math.max(-1, a.afterFixed)),
  }))
  if (n < 2) return { kind: 'unavailable', reason: 'Add at least two stops first.' }
  if (!fixed.some((id) => env.map.nodeOfTerminal(id))) {
    return { kind: 'unavailable', reason: 'None of the stops has a position on the map.' }
  }
  const t0 = performance.now()
  const budgetMs = req.budgetMs ?? DEFAULT_BUDGET_MS

  // --- candidates, pruned per gap by the single-stop detour --------------------------------
  const pool = candidateTerminals(
    env.terminals,
    [...fixed, ...accepted.map((a) => a.terminalId)],
    req.dismissed,
    env.map,
    env.data,
  )
  const acceptedInGap = (g: number) => accepted.filter((a) => a.afterFixed === g).length
  const gapCandidates: number[][] = [] // terminal ids per gap
  for (let g = 0; g < n - 1; g++) {
    const dAB = env.map.distance(fixed[g], fixed[g + 1])
    if (dAB === null || options.perGap - acceptedInGap(g) < 1) {
      gapCandidates.push([])
      continue
    }
    const limit = (dAB * options.detourPct) / 100 + EPS
    gapCandidates.push(
      pool
        .filter((t) => {
          const dAX = env.map.distance(fixed[g], t.id)
          const dXB = env.map.distance(t.id, fixed[g + 1])
          return dAX !== null && dXB !== null && dAX + dXB <= limit
        })
        .map((t) => t.id),
    )
  }

  // --- universe of terminals, pair profits and distances ------------------------------------
  const ids: number[] = []
  const indexOf = new Map<number, number>()
  const add = (id: number) => {
    if (!indexOf.has(id)) {
      indexOf.set(id, ids.length)
      ids.push(id)
    }
  }
  fixed.forEach(add)
  accepted.forEach((a) => add(a.terminalId))
  for (const list of gapCandidates) list.forEach(add)
  const u = ids.length
  const pp = pairProfits(ids, req.calc, env.data, req.nowSec)
  const w = (a: number, b: number) => pp.profit[a * u + b]
  const dist = new Float64Array(u * u).fill(Number.NaN)
  for (let a = 0; a < u; a++) {
    for (let b = 0; b < u; b++) {
      const d = env.map.distance(ids[a], ids[b])
      if (d !== null) dist[a * u + b] = d
    }
  }
  const D = (a: number, b: number) => dist[a * u + b]
  const groupKeys = ids.map((id) => {
    const node = env.map.nodeOfTerminal(id)
    return node ? env.map.groupOf(node) : `terminal:${id}`
  })
  const groupList = [...new Set(groupKeys)]
  const groupOfU = groupKeys.map((key) => groupList.indexOf(key))

  // candidates that cannot trade with anybody in the universe are useless
  const useful = (x: number) => {
    for (let y = 0; y < u; y++) if (y !== x && (w(x, y) > 0 || w(y, x) > 0)) return true
    return false
  }
  const gapU: number[][] = gapCandidates.map((list) =>
    list.map((id) => indexOf.get(id) ?? -1).filter((x) => x >= 0 && useful(x)),
  )
  const fixedU = fixed.map((id) => indexOf.get(id) ?? -1)
  /** Accepted stops (universe indexes) per gap, shifted by one: slot 0 = before the first fixed stop. */
  const acceptedU: number[][] = Array.from({ length: n + 1 }, () => [])
  for (const a of accepted) acceptedU[a.afterFixed + 1].push(indexOf.get(a.terminalId) ?? -1)

  // --- depth-first search -------------------------------------------------------------------
  const seq = new Int32Array(MAX_ROUTE_STOPS + 1)
  const kind = new Uint8Array(MAX_ROUTE_STOPS + 1)
  const f = new Float64Array(MAX_ROUTE_STOPS + 1)
  let m = 0
  let dyn = accepted.length
  let distSum = 0
  const used = new Uint8Array(u)
  const groupCount = new Int32Array(groupList.length)
  for (const list of acceptedU) for (const x of list) groupCount[groupOfU[x]]++
  let bestFound = false
  let nodes = 0
  const holder: { best: Best | null } = { best: null }

  const push = (x: number, k: number) => {
    let top = m > 0 ? f[m - 1] : 0
    for (let i = 0; i < m; i++) {
      const p = f[i] + w(seq[i], x)
      if (p > top) top = p
    }
    f[m] = top
    if (m > 0) {
      const d = D(seq[m - 1], x)
      distSum += Number.isNaN(d) ? 0 : d
    }
    seq[m] = x
    kind[m] = k
    m++
  }
  const pop = () => {
    m--
    if (m > 0) {
      const d = D(seq[m - 1], seq[m])
      distSum -= Number.isNaN(d) ? 0 : d
    }
  }

  const newIds = (s: ArrayLike<number>, kinds: ArrayLike<number>, len: number) => {
    const out: number[] = []
    for (let i = 0; i < len; i++) if (kinds[i] === NEW) out.push(ids[s[i]])
    return out
  }

  /** Strictly better than the current best? (profit↑, distance↓, dynamic stops↓, ids lexicographic) */
  const better = (): boolean => {
    const current = holder.best
    if (!current) return true
    const p = f[m - 1]
    if (p !== current.p) return p > current.p
    if (Math.abs(distSum - current.dist) > EPS) return distSum < current.dist
    if (dyn !== current.dyn) return dyn < current.dyn
    const mine = newIds(seq, kind, m)
    const theirs = newIds(current.seq, current.kind, current.seq.length)
    for (let i = 0; i < mine.length; i++) if (mine[i] !== theirs[i]) return mine[i] < theirs[i]
    return false
  }

  /** Forward rule: leaving a planetary group must bring the stop closer to the next fixed stop. */
  const forwardOk = (from: number, to: number, target: number) => {
    if (groupOfU[from] === groupOfU[to]) return true
    const dTo = D(to, target)
    const dFrom = D(from, target)
    return !Number.isNaN(dTo) && !Number.isNaN(dFrom) && dTo < dFrom
  }

  const gapBudget = fixedU.map((a, g) =>
    g < n - 1 ? (D(a, fixedU[g + 1]) * options.detourPct) / 100 + EPS : 0,
  )

  const record = () => {
    if (!better()) return
    holder.best = {
      p: f[m - 1],
      dist: distSum,
      dyn,
      seq: Array.from(seq.subarray(0, m)),
      kind: Array.from(kind.subarray(0, m)),
    }
  }

  /**
   * Fill the gap after fixed stop `g`. `placed` accepted stops of the gap are in the sequence
   * already, `fresh` new stops were inserted, `gapDist` is the path length from the gap's first
   * stop to the last one, and `bad` records a forward or distance violation among the stops so
   * far. A gap without new stops is never judged (accepted stops are left as the user placed
   * them); a gap with new stops has to satisfy the detour and forward rules as a whole.
   */
  const dfs = (g: number, placed: number, fresh: number, gapDist: number, bad: boolean) => {
    if ((++nodes & 1023) === 0 && performance.now() - t0 > budgetMs) bestFound = true
    if (bestFound) return
    const last = seq[m - 1]
    const B = fixedU[g + 1]
    const inGap = acceptedU[g + 1]

    // option 1: the next accepted stop of the gap comes next (forced order, never skipped)
    if (placed < inGap.length) {
      const x = inGap[placed]
      const dLX = D(last, x)
      const nextBad = bad || Number.isNaN(dLX) || !forwardOk(last, x, B)
      if (fresh === 0 || !nextBad) {
        push(x, ACCEPTED)
        dfs(g, placed + 1, fresh, gapDist + (Number.isNaN(dLX) ? 0 : dLX), nextBad)
        pop()
      }
    } else {
      // option 2: leave the gap, the next stop is the fixed stop B
      const dLB = D(last, B)
      const closeOk =
        fresh === 0 ||
        (!bad && !Number.isNaN(dLB) && gapDist + dLB <= gapBudget[g] && forwardOk(last, B, B))
      if (closeOk) {
        push(B, FIXED)
        if (g + 1 === n - 1) {
          const tail = acceptedU[n]
          for (const x of tail) push(x, ACCEPTED)
          record()
          for (let i = 0; i < tail.length; i++) pop()
        } else {
          dfs(g + 1, 0, 0, 0, false)
        }
        pop()
      }
    }

    // option 3: insert one more new stop here (before the next accepted stop, if any)
    if (
      bad ||
      fresh + inGap.length >= options.perGap ||
      dyn >= options.total ||
      n + dyn + 1 > MAX_ROUTE_STOPS
    ) {
      return
    }
    for (const x of gapU[g]) {
      if (used[x] || groupCount[groupOfU[x]] >= options.perGroup) continue
      const dLX = D(last, x)
      const dXB = D(x, B)
      if (Number.isNaN(dLX) || Number.isNaN(dXB)) continue
      if (gapDist + dLX + dXB > gapBudget[g]) continue
      if (!forwardOk(last, x, B)) continue
      used[x] = 1
      groupCount[groupOfU[x]]++
      dyn++
      push(x, NEW)
      dfs(g, placed, fresh + 1, gapDist + dLX, false)
      pop()
      dyn--
      groupCount[groupOfU[x]]--
      used[x] = 0
      if (bestFound) return
    }
  }

  for (const x of acceptedU[0]) push(x, ACCEPTED)
  push(fixedU[0], FIXED)
  dfs(0, 0, 0, 0, false)
  const chosen = holder.best
  if (!chosen) return { kind: 'none', bestFound }

  // --- result: drop new stops the chain does not use, rebuild chain and roles ---------------
  const chain = bestChain(chosen.seq, w)
  const onChain = new Set<number>()
  for (const leg of chain.legs) {
    onChain.add(leg.from)
    onChain.add(leg.to)
  }
  const keep = chosen.seq.map((_, i) => chosen.kind[i] !== NEW || onChain.has(i))
  const finalSeq = chosen.seq.filter((_, i) => keep[i])
  const finalKind = chosen.kind.filter((_, i) => keep[i])
  const final = bestChain(finalSeq, w)
  // the current route: fixed and accepted stops, without any suggestion
  const current = finalSeq.filter((_, i) => finalKind[i] !== NEW)
  const before = bestChain(current, w)
  if (!(final.profit > before.profit) || finalKind.every((k) => k !== NEW)) {
    return { kind: 'none', bestFound }
  }

  const nameOf = (a: number, b: number) =>
    env.data.commodityById.get(pp.commodity[a * u + b])?.name ?? ''
  const legs: StopoverLeg[] = final.legs.map((l) => ({
    from: l.from,
    to: l.to,
    commodityName: nameOf(finalSeq[l.from], finalSeq[l.to]),
    profit: l.profit,
  }))

  const stops: SuggestedStop[] = []
  let gap = -1
  let position = 0
  let existing = 0
  finalSeq.forEach((x, i) => {
    if (finalKind[i] !== NEW) {
      if (finalKind[i] === FIXED) {
        gap++
        position = 0
      }
      existing++
      return
    }
    const role: SuggestedRole = {}
    for (const l of final.legs) {
      const name = nameOf(finalSeq[l.from], finalSeq[l.to])
      if (l.from === i) {
        role.buy = { commodityName: name, toTerminalId: ids[finalSeq[l.to]], toIndex: l.to }
      }
      if (l.to === i) {
        role.sell = {
          commodityName: name,
          fromTerminalId: ids[finalSeq[l.from]],
          fromIndex: l.from,
        }
      }
    }
    stops.push({
      terminalId: ids[x],
      gapIndex: gap,
      position: position++,
      routeIndex: i,
      insertAt: existing,
      role,
    })
  })

  const pathLength = (path: number[]) => {
    let sum = 0
    for (let i = 1; i < path.length; i++) {
      const d = D(path[i - 1], path[i])
      if (!Number.isNaN(d)) sum += d
    }
    return sum
  }

  return {
    kind: 'ok',
    result: {
      stops,
      profitBefore: before.profit,
      profitAfter: final.profit,
      distanceBefore: pathLength(current),
      distanceAfter: pathLength(finalSeq),
      legs,
      route: finalSeq.map((x) => ids[x]),
      origins: finalKind.map((k): StopOrigin => (k === FIXED ? 'fixed' : 'dynamic')),
      bestFound,
    },
  }
}
