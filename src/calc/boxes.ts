export interface BoxCount {
  size: number
  count: number
}

interface Table {
  cap: number
  /** reach[k] = 1 when exactly k SCU can be packed from the allowed sizes. */
  reach: Uint8Array
  /** best[k] = largest reachable amount ≤ k. */
  best: Int32Array
}

const MAX_TABLES = 64
const tables = new Map<string, Table>()

const normalize = (sizes: readonly number[]) =>
  [...new Set(sizes.filter((s) => Number.isInteger(s) && s > 0))].sort((a, b) => a - b)

/** Unbounded-knapsack reachability DP, O(cap·|sizes|). */
function buildTable(sizes: number[], cap: number): Table {
  const reach = new Uint8Array(cap + 1)
  const best = new Int32Array(cap + 1)
  reach[0] = 1
  for (let k = 1; k <= cap; k++) {
    for (const s of sizes) {
      if (s > k) break
      if (reach[k - s]) {
        reach[k] = 1
        break
      }
    }
    best[k] = reach[k] ? k : best[k - 1]
  }
  return { cap, reach, best }
}

/** One table per size set, grown on demand; answers every cap ≤ table.cap. */
function tableFor(sizes: number[], cap: number): Table {
  const key = sizes.join(',')
  let table = tables.get(key)
  if (!table || table.cap < cap) {
    if (tables.size >= MAX_TABLES) tables.clear()
    table = buildTable(sizes, cap)
    tables.set(key, table)
  }
  return table
}

/**
 * Largest integer ≤ `cap` that is a non-negative integer combination of `sizes`
 * (0 if none). Example: (46, {8,16}) = 40, (7, {8,16}) = 0.
 */
export function maxFillable(cap: number, sizes: readonly number[]): number {
  const limit = Math.floor(cap)
  const allowed = normalize(sizes)
  if (!(limit > 0) || allowed.length === 0) return 0
  if (allowed[0] === 1) return limit
  return tableFor(allowed, limit).best[limit]
}

/**
 * Box breakdown of `qty` SCU, largest boxes first. Greedy largest-first, but every step
 * is checked against the DP so it always succeeds for representable quantities.
 * Returns [] for 0 or an unrepresentable quantity.
 */
export function decomposeBoxes(qty: number, sizes: readonly number[]): BoxCount[] {
  const total = Math.floor(qty)
  const allowed = normalize(sizes)
  if (!(total > 0) || allowed.length === 0) return []
  const { reach } = tableFor(allowed, total)
  if (!reach[total]) return []
  const counts = new Map<number, number>()
  const descending = [...allowed].reverse()
  let remaining = total
  while (remaining > 0) {
    const size = descending.find((s) => s <= remaining && reach[remaining - s])
    if (size === undefined) return [] // unreachable: reach[remaining] is always set here
    counts.set(size, (counts.get(size) ?? 0) + 1)
    remaining -= size
  }
  return [...counts].map(([size, count]) => ({ size, count })).sort((a, b) => b.size - a.size)
}
