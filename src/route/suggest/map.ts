import type { TerminalMapData, TerminalMapNode } from '../../domain/terminalMap'

/** Derived lookups over a terminal map file (§5.4), built once per file. */
export interface MapIndexes {
  data: TerminalMapData
  nodeOfTerminal: (terminalId: number) => TerminalMapNode | undefined
  /** Directed travel distance in Gm between two nodes; null = unreachable. */
  travel: (from: TerminalMapNode, to: TerminalMapNode) => number | null
  /** Directed distance between two terminals: 0 within a node, null when unknown. */
  distance: (fromTerminalId: number, toTerminalId: number) => number | null
  groupOf: (node: TerminalMapNode) => string
  systemOf: (node: TerminalMapNode) => number
}

const cache = new WeakMap<TerminalMapData, MapIndexes>()

export function buildMapIndexes(data: TerminalMapData): MapIndexes {
  const cached = cache.get(data)
  if (cached) return cached
  const nodeById = new Map(data.nodes.map((n) => [n.id, n]))
  const n = data.nodes.length
  const nodeOfTerminal = (terminalId: number) => {
    const id = data.terminalNode[String(terminalId)]
    return id === undefined ? undefined : nodeById.get(id)
  }
  const travel = (from: TerminalMapNode, to: TerminalMapNode) =>
    from.index === to.index ? 0 : (data.travel[from.index * n + to.index] ?? null)
  const indexes: MapIndexes = {
    data,
    nodeOfTerminal,
    travel,
    distance: (a, b) => {
      const from = nodeOfTerminal(a)
      const to = nodeOfTerminal(b)
      return from && to ? travel(from, to) : null
    },
    groupOf: (node) => node.group ?? node.id,
    systemOf: (node) => node.system,
  }
  cache.set(data, indexes)
  return indexes
}
