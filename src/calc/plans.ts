import { decomposeBoxes, maxFillable } from './boxes'
import { NO_FLAGS, type Haul, type HaulFlags, type Load, type LoadPart, type Plan } from './types'

export const TOP_K = 5

function part(haul: Haul, qty: number): LoadPart {
  const investment = haul.unitBuy * qty
  const revenue = haul.unitSell * qty
  return {
    haul,
    qty,
    boxes: decomposeBoxes(qty, haul.boxSizes),
    investment,
    revenue,
    profit: revenue - investment,
  }
}

/**
 * One load for the stop pair (from, to): fill the free space greedily, best margin first.
 * Usually a single commodity; a second one is added only when box granularity leaves
 * space unused (46 SCU free, best commodity only in 8/16 boxes → 40 + 6 of the next).
 */
export function buildLoad(
  from: number,
  to: number,
  candidates: Haul[],
  freeScu: number,
): Load | null {
  const sorted = [...candidates].sort(
    (a, b) => b.margin - a.margin || b.profit - a.profit || (a.id < b.id ? -1 : 1),
  )
  let remaining = Math.floor(freeScu)
  const parts: LoadPart[] = []
  for (const haul of sorted) {
    if (remaining <= 0) break
    const qty = maxFillable(remaining, haul.boxSizes)
    if (qty <= 0) continue
    parts.push(part(haul, qty))
    remaining -= qty
  }
  if (parts.length === 0) return null
  const sum = (f: (p: LoadPart) => number) => parts.reduce((acc, p) => acc + f(p), 0)
  return {
    from,
    to,
    parts,
    scu: sum((p) => p.qty),
    investment: sum((p) => p.investment),
    revenue: sum((p) => p.revenue),
    profit: sum((p) => p.profit),
  }
}

/** Build one load for every stop pair (i, j), i < j, that has candidates. */
export function buildLoads(hauls: Haul[], freeScu: number): Map<string, Load> {
  const byPair = new Map<string, Haul[]>()
  for (const haul of hauls) {
    const key = `${haul.from}-${haul.to}`
    const list = byPair.get(key)
    if (list) list.push(haul)
    else byPair.set(key, [haul])
  }
  const loads = new Map<string, Load>()
  for (const [key, candidates] of byPair) {
    const load = buildLoad(candidates[0].from, candidates[0].to, candidates, freeScu)
    if (load) loads.set(key, load)
  }
  return loads
}

const mergeFlags = (a: HaulFlags, b: HaulFlags): HaulFlags => ({
  illegal: a.illegal || b.illegal,
  volatileTime: a.volatileTime || b.volatileTime,
  temporary: a.temporary || b.temporary,
  noStock: a.noStock || b.noStock,
  lowStock: a.lowStock || b.lowStock,
  noDemand: a.noDemand || b.noDemand,
  lowDemand: a.lowDemand || b.lowDemand,
  boxSizesUnknown: a.boxSizesUnknown || b.boxSizesUnknown,
  shipBoxSizesUnknown: a.shipBoxSizesUnknown || b.shipBoxSizesUnknown,
  stale: a.stale || b.stale,
})

const hasInventoryWarning = (f: HaulFlags) => f.noStock || f.lowStock || f.noDemand || f.lowDemand

/** SCU on board while flying segment s (between stop s and stop s+1). */
export function onBoardPerSegment(loads: Load[], stopCount: number): number[] {
  const segments = new Array<number>(Math.max(0, stopCount - 1)).fill(0)
  for (const load of loads) {
    for (let s = load.from; s < load.to; s++) segments[s] += load.scu
  }
  return segments
}

/** Cash needed up front: at each stop sell first, then buy; −min(running cash). */
export function capitalRequired(loads: Load[], stopCount: number): number {
  let cash = 0
  let minCash = 0
  for (let stop = 0; stop < stopCount; stop++) {
    for (const load of loads) if (load.to === stop) cash += load.revenue
    for (const load of loads) if (load.from === stop) cash -= load.investment
    minCash = Math.min(minCash, cash)
  }
  return minCash < 0 ? -minCash : 0
}

export function makePlan(loads: Load[], stopCount: number): Plan {
  const profit = loads.reduce((s, l) => s + l.profit, 0)
  const investment = loads.reduce((s, l) => s + l.investment, 0)
  const revenue = loads.reduce((s, l) => s + l.revenue, 0)
  const parts = loads.flatMap((l) => l.parts)
  let oldest: number | null = null
  let flags = NO_FLAGS
  for (const p of parts) {
    flags = mergeFlags(flags, p.haul.flags)
    for (const age of [p.haul.buyAgeDays, p.haul.sellAgeDays]) {
      if (age !== null && (oldest === null || age > oldest)) oldest = age
    }
  }
  return {
    loads,
    profit,
    investment,
    revenue,
    roi: investment > 0 ? profit / investment : 0,
    peakScu: Math.max(0, ...onBoardPerSegment(loads, stopCount)),
    capitalRequired: capitalRequired(loads, stopCount),
    transactions: parts.length * 2,
    oldestPriceAgeDays: oldest,
    warningCount: parts.filter((p) => hasInventoryWarning(p.haul.flags)).length,
    flags,
    key: loads
      .map(
        (l) =>
          `${l.from}>${l.to}:${l.parts.map((p) => `${p.haul.commodity.id}x${p.qty}`).join('+')}`,
      )
      .join('|'),
  }
}

/**
 * Plans by dynamic programming over stops (§6.5):
 *   best[0] = {∅};  best[k] = topK( best[k−1] ∪ { p + load(i,k) : i < k, p ∈ best[i] } )
 * `best[i]` holds plans whose last load ends at stop ≤ i, so extending with a load that
 * starts at i never overlaps. Returns the top-K non-empty plans of `best[n−1]`, best first.
 */
export function buildPlans(
  hauls: Haul[],
  stopCount: number,
  freeScu: number,
  topK: number = TOP_K,
): Plan[] {
  if (stopCount < 2 || hauls.length === 0) return []
  const loads = buildLoads(hauls, freeScu)
  const compare = (a: Plan, b: Plan) =>
    b.profit - a.profit ||
    a.transactions - b.transactions ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)

  const best: Plan[][] = [[makePlan([], stopCount)]]
  for (let k = 1; k < stopCount; k++) {
    const pool = new Map<string, Plan>()
    for (const plan of best[k - 1]) pool.set(plan.key, plan)
    for (let i = 0; i < k; i++) {
      const load = loads.get(`${i}-${k}`)
      if (!load) continue
      for (const prev of best[i]) {
        const plan = makePlan([...prev.loads, load], stopCount)
        pool.set(plan.key, plan)
      }
    }
    best.push([...pool.values()].sort(compare).slice(0, topK))
  }
  return best[stopCount - 1].filter((p) => p.loads.length > 0)
}
