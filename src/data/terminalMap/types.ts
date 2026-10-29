/** Shape of `src/data/terminalMap/<gameVersion>.json`, written by tools/terminal-map (docs/terminal-map.md §5). */

export type TerminalMapNodeKind = 'planet' | 'moon' | 'station' | 'orbit'

export interface TerminalMapNode {
  /** `planet:116`, `moon:1`, `station:24`, `orbit:325` */
  id: string
  /** UEX star system id */
  system: number
  kind: TerminalMapNodeKind
  name: string
  orbitId: number
  /** Parent planet node (a planet is its own group); null for standalone nodes (gateways, Delamar, …). */
  group: string | null
  terminalIds: number[]
  hasCommodityTerminal: boolean
  /** System-local coordinates in Gm. */
  x: number
  y: number
  /** True when placed by the co-orbit spread rule instead of by distance data. */
  offset: boolean
}

export interface TerminalMapSystem {
  id: number
  name: string
  /** Matrix order of `distances` and `estimated`. */
  orbitIds: number[]
  /** Reported orbit distances `[i, j, Gm]` with i < j. */
  distances: [number, number, number][]
  /** Pairs without a usable report: the distance of the fitted points (not data). */
  estimated: [number, number, number][]
  /** Placement of the system's panel in the combined map. */
  layout: { cx: number; cy: number; rotationDeg: number }
  quality: {
    stress1: number
    meanRelError: number
    maxRelError: number
    planarShare: number
    pairs: number
    estimatedPairs: number
    oldestRowVersion: string
    newestRowVersion: string
  }
}

export interface TerminalMapJump {
  a: string
  b: string
  /** Gm, constant. */
  cost: number
  jumpPointIds: number[]
}

export interface TerminalMapData {
  schemaVersion: number
  gameVersion: string
  units: 'Gm'
  generator: {
    source: string
    weights: string
    maxIterations: number
    jumpCost: number
    coOrbitSpread: number
    panelGap: number
  }
  systems: TerminalMapSystem[]
  nodes: TerminalMapNode[]
  jumps: TerminalMapJump[]
  /** terminal id (as string) → node id */
  terminalNode: Record<string, string>
}
