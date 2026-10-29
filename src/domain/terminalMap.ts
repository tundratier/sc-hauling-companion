/**
 * Shape of the terminal map files `public/terminal-map/<gameVersion>.json` and `index.json`,
 * written by tools/terminal-map (docs/terminal-map.md §5). Types only: the files are fetched at
 * runtime, nothing here may import them. Both files carry `schemaVersion` 2.
 */

export type TerminalMapNodeKind = 'planet' | 'moon' | 'station' | 'orbit'

export interface TerminalMapNode {
  /** Position in `TerminalMapData.nodes`, and the row/column of `travel`. */
  index: number
  /** `planet:116`, `moon:1`, `station:24`, `orbit:325` */
  id: string
  /** UEX star system id */
  system: number
  kind: TerminalMapNodeKind
  name: string
  orbitId: number
  /**
   * Planetary group: the planet node id for a planet and its moons/stations. Null for a standalone
   * node (gateways, Nyx stations, Delamar), which is its own group.
   */
  group: string | null
  terminalIds: number[]
  hasCommodityTerminal: boolean
  /** System-local coordinates in Gm, for drawing. */
  x: number
  y: number
  /** True when placed by the co-orbit spread rule instead of by distance data. */
  offset: boolean
}

export interface TerminalMapSystem {
  id: number
  name: string
  /** Orbit ids the fit used; the indices in `estimated` refer to this list. */
  orbitIds: number[]
  /** Orbit pairs without a usable report `[i, j, Gm]`, i < j: the distance of the fitted points. */
  estimated: [number, number, number][]
  /** Placement of the system's panel in the combined map: rotate by `rotationDeg`, then move by `cx`, `cy`. */
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
    coOrbitCost: number
    panelGap: number
  }
  systems: TerminalMapSystem[]
  nodes: TerminalMapNode[]
  jumps: TerminalMapJump[]
  /** terminal id (as string) → node id; a terminal missing here has no node. */
  terminalNode: Record<string, string>
  /**
   * Directed shortest travel distance in Gm between every pair of nodes, row-major, length
   * `nodes.length ** 2`: `travel[from.index * nodes.length + to.index]`. 0 on the diagonal, null
   * where unreachable. Not symmetric (docs/terminal-map.md §2.5).
   */
  travel: (number | null)[]
}

export interface TerminalMapIndex {
  schemaVersion: number
  /** Compiled game versions, oldest first. */
  versions: string[]
}
