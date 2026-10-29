import type { TerminalMapData, TerminalMapNode } from '../domain/terminalMap'

export interface TestNode {
  id: string
  /** Position on a line in Gm (default distance = |xa − xb|). */
  x: number
  system?: number
  /** Planetary group (planet node id); null/undefined = standalone. */
  group?: string | null
  terminals: number[]
}

/**
 * Small hand-written terminal map for tests. Distances default to the distance on a line; pass
 * `d` to override pairs (return `undefined` to keep the default, `null` for unreachable).
 */
export function testMap(
  nodes: TestNode[],
  d?: (from: TestNode, to: TestNode) => number | null | undefined,
): TerminalMapData {
  const mapNodes: TerminalMapNode[] = nodes.map((n, index) => ({
    index,
    id: n.id,
    system: n.system ?? 1,
    kind: n.id.startsWith('moon') ? 'moon' : n.id.startsWith('planet') ? 'planet' : 'station',
    name: n.id,
    orbitId: 100 + index,
    group: n.group ?? null,
    terminalIds: n.terminals,
    hasCommodityTerminal: true,
    x: n.x,
    y: 0,
    offset: false,
  }))
  const travel: (number | null)[] = []
  for (const a of nodes) {
    for (const b of nodes) {
      if (a === b) travel.push(0)
      else {
        const custom = d?.(a, b)
        travel.push(custom === undefined ? Math.abs(a.x - b.x) : custom)
      }
    }
  }
  const terminalNode: Record<string, string> = {}
  for (const n of nodes) for (const t of n.terminals) terminalNode[String(t)] = n.id
  return {
    schemaVersion: 2,
    gameVersion: 'test',
    units: 'Gm',
    generator: {
      source: 'test',
      weights: '1/d',
      maxIterations: 1,
      jumpCost: 70,
      coOrbitSpread: 0.15,
      coOrbitCost: 0.15,
      panelGap: 20,
    },
    systems: [],
    nodes: mapNodes,
    jumps: [],
    terminalNode,
    travel,
  }
}
