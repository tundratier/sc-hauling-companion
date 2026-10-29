import { describe, expect, it } from 'vitest'
import { compareGameVersions, loadTerminalMap, terminalMapVersions } from '.'

describe('compareGameVersions', () => {
  it('compares numerically, not as text', () => {
    expect(compareGameVersions('4.10.2', '4.7.1')).toBeGreaterThan(0)
    expect(compareGameVersions('4.0', '4.0.0')).toBe(0)
    expect(compareGameVersions('3.24.2a', '3.24.2')).toBeGreaterThan(0)
    expect(['4.10.2', '4.3.2', '3.24.2'].sort(compareGameVersions)).toEqual([
      '3.24.2',
      '4.3.2',
      '4.10.2',
    ])
  })
})

describe('loadTerminalMap', () => {
  it('lists the compiled versions', () => {
    expect(terminalMapVersions).toContain('4.10.2')
  })

  it('loads the exact version', async () => {
    const map = await loadTerminalMap('4.10.2')
    expect(map?.exact).toBe(true)
    expect(map?.data.gameVersion).toBe('4.10.2')
  })

  it('falls back to the newest older map and says so', async () => {
    const map = await loadTerminalMap('4.11.0')
    expect(map?.exact).toBe(false)
    expect(map?.data.gameVersion).toBe('4.10.2')
  })

  it('has no map for a game version older than every compiled one', async () => {
    expect(await loadTerminalMap('3.0.0')).toBeNull()
  })

  it('has a consistent data file', async () => {
    const data = (await loadTerminalMap('4.10.2'))?.data
    expect(data).toBeDefined()
    if (!data) return
    const nodeIds = new Set(data.nodes.map((n) => n.id))
    expect(nodeIds.size).toBe(data.nodes.length)
    expect(data.jumps.every((j) => nodeIds.has(j.a) && nodeIds.has(j.b))).toBe(true)
    expect(Object.values(data.terminalNode).every((id) => nodeIds.has(id))).toBe(true)
    expect(data.nodes.every((n) => n.group === null || nodeIds.has(n.group))).toBe(true)
    for (const system of data.systems) {
      const n = system.orbitIds.length
      expect(system.distances.length + system.estimated.length).toBe((n * (n - 1)) / 2)
    }
  })
})
