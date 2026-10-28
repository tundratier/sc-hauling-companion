import { describe, expect, it } from 'vitest'
import { terminal } from '../test-utils/calcFixtures'
import { terminalDisplay } from './terminalDisplay'

// Fixture terminals taken from the real data of 2026-10-27 (SPEC §7.4).
const hahn = terminal(1, {
  name: 'HDMS-Hahn',
  displayname: 'HDMS-Hahn',
  planetName: 'Hurston',
  moonName: 'Magda',
  starSystemName: 'Stanton',
})
const shubin = terminal(2, {
  name: 'Shubin Mining Facility SM0-22',
  displayname: 'Shubin Mining Facility SM0-22',
  planetName: 'MicroTech',
  moonName: '',
  starSystemName: 'Stanton',
})
const arcAdmin = terminal(3, {
  name: 'Admin - ARC-L1',
  displayname: 'ARC-L1 Wide Forest Station',
  planetName: 'ArcCorp',
  moonName: '',
  starSystemName: 'Stanton',
})
const arcPlatinum = terminal(4, {
  name: 'Platinum Bay - ARC-L1',
  displayname: 'ARC-L1 Wide Forest Station',
  planetName: 'ArcCorp',
  starSystemName: 'Stanton',
})
const area18 = terminal(5, {
  name: 'TDD - Trade and Development Division - Area 18',
  displayname: 'Area18',
  planetName: 'ArcCorp',
  starSystemName: 'Stanton',
})

describe('terminalDisplay (SPEC §7.4 examples)', () => {
  it.each([
    [hahn, 'HDMS-Hahn', 'Hurston · Magda · Stanton'],
    [shubin, 'Shubin Mining Facility SM0-22', 'MicroTech · Stanton'],
    [arcAdmin, 'ARC-L1 Wide Forest Station', 'Admin - ARC-L1 · ArcCorp · Stanton'],
    [arcPlatinum, 'ARC-L1 Wide Forest Station', 'Platinum Bay - ARC-L1 · ArcCorp · Stanton'],
    [area18, 'Area18', 'TDD - Trade and Development Division - Area 18 · ArcCorp · Stanton'],
  ])('%#: primary and secondary line', (t, primary, secondary) => {
    expect(terminalDisplay(t)).toEqual({ primary, secondary })
  })

  it('never repeats the primary line (HDMS-Hahn does not show its name again)', () => {
    expect(terminalDisplay(hahn).secondary).not.toContain('HDMS')
  })

  it('keeps terminals with the same displayname apart by name', () => {
    expect(terminalDisplay(arcAdmin).secondary).not.toBe(terminalDisplay(arcPlatinum).secondary)
  })

  it('skips parts contained in an earlier part, ignoring case and spacing', () => {
    const t = terminal(6, {
      name: 'Admin - Port Olisar',
      displayname: 'Port Olisar',
      planetName: 'crusader',
      moonName: 'Crusader Moon', // not contained IN an earlier part → kept
      starSystemName: 'CRUSADER',
    })
    expect(terminalDisplay(t).secondary).toBe('Admin - Port Olisar · crusader · Crusader Moon')
  })

  it('treats "Area 18" and "Area18" as the same text', () => {
    const t = terminal(7, {
      name: 'Area 18',
      displayname: 'Area18',
      planetName: '',
      starSystemName: '',
    })
    expect(terminalDisplay(t).secondary).toBe('')
  })

  it('falls back to the name when there is no displayname and handles empty parts', () => {
    const t = terminal(8, {
      name: 'Lonely Outpost',
      displayname: '',
      planetName: '',
      moonName: '',
      starSystemName: '',
    })
    expect(terminalDisplay(t)).toEqual({ primary: 'Lonely Outpost', secondary: '' })
    expect(terminalDisplay({ ...t, planetName: '  ' }).secondary).toBe('')
  })
})
