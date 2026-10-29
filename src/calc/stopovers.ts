import type { Haul, StopoverLeg } from './types'

interface Chain {
  profit: number
  legs: StopoverLeg[]
}

const EMPTY: Chain = { profit: 0, legs: [] }

const legOf = (h: Haul): StopoverLeg => ({
  from: h.from,
  to: h.to,
  commodityName: h.commodity.name,
  profit: h.profit,
})

/**
 * Compares every skip haul i→j with the best chain of hauls that sells at a skipped stop
 * (§6.6). Interval DP over the stops:
 * - best(a, b): most profit between stops a and b — the best direct haul, a chain through a
 *   stop in between, or nothing (0);
 * - via(a, b) = max over a < k < b of best(a, k) + best(k, b).
 * Returns new haul objects; hauls without skips are returned unchanged.
 */
export function compareStopovers(hauls: Haul[], stopCount: number): Haul[] {
  const n = stopCount
  const direct: (Haul | undefined)[][] = Array.from({ length: n }, () => Array<Haul>(n))
  for (const h of hauls) {
    const current = direct[h.from]?.[h.to]
    if (!current || h.profit > current.profit) direct[h.from][h.to] = h
  }

  const best: Chain[][] = Array.from({ length: n }, () => Array<Chain>(n).fill(EMPTY))
  const via: (Chain | null)[][] = Array.from({ length: n }, () => Array<Chain | null>(n).fill(null))
  for (let len = 1; len < n; len++) {
    for (let a = 0; a + len < n; a++) {
      const b = a + len
      let chain: Chain | null = null
      for (let k = a + 1; k < b; k++) {
        const profit = best[a][k].profit + best[k][b].profit
        if (!chain || profit > chain.profit) {
          chain = { profit, legs: [...best[a][k].legs, ...best[k][b].legs] }
        }
      }
      via[a][b] = chain
      const d = direct[a][b]
      let top = chain ?? EMPTY
      if (d && d.profit > top.profit) top = { profit: d.profit, legs: [legOf(d)] }
      best[a][b] = top
    }
  }

  return hauls.map((h) => {
    const chain = h.skips > 0 ? via[h.from][h.to] : null
    return chain ? { ...h, stopovers: { ...chain, delta: h.profit - chain.profit } } : h
  })
}
