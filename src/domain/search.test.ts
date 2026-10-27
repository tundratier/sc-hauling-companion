import { describe, expect, it, vi } from 'vitest'
import terminalsFixture from '../__fixtures__/terminals.json'
import vehiclesFixture from '../__fixtures__/vehicles.json'
import { mapTerminals, mapVehicles } from '../api/mappers'
import { terminal } from '../test-utils/calcFixtures'
import { normalize, searchTerminals, searchVehicles } from './search'

vi.spyOn(console, 'warn').mockImplementation(() => {})
const terminals = mapTerminals(terminalsFixture.data)
const vehicles = mapVehicles(vehiclesFixture.data)
const ids = (list: { id: number }[]) => list.map((t) => t.id)

describe('normalize', () => {
  it('lower-cases, strips diacritics and treats - _ . and apostrophes as spaces', () => {
    expect(normalize('ARC-L1')).toBe('arc l1')
    expect(normalize("Samson & Son's")).toBe('samson & son s')
    expect(normalize('Café_Ñandú.Bar')).toBe('cafe nandu bar')
    expect(normalize('  a   b ')).toBe('a b')
  })
})

describe('searchTerminals (criterion 3)', () => {
  it.each(['arc l1', 'ARCL1', 'ARC-L1', 'wide forest', 'arcl1 wide', 'arc'])(
    '"%s" finds ARC-L1 Wide Forest Station',
    (query) => {
      expect(ids(searchTerminals(terminals, query))).toContain(10)
    },
  )

  it('"area18" finds every Area 18 terminal, distinguishable by name', () => {
    const result = searchTerminals(terminals, 'area18')
    expect(ids(result).sort()).toEqual([11, 12])
    expect(result.map((t) => t.name).sort()).toEqual([
      'Admin - Area 18',
      'TDD - Trade and Development Division - Area 18',
    ])
    expect(result.every((t) => t.displayname === 'Area18')).toBe(true)
  })

  it('also matches "area 18" and "tdd area 18"', () => {
    expect(ids(searchTerminals(terminals, 'area 18')).sort()).toEqual([11, 12])
    expect(ids(searchTerminals(terminals, 'tdd area 18'))).toEqual([11])
  })

  it('requires every token to match', () => {
    expect(searchTerminals(terminals, 'arc zzz')).toEqual([])
    expect(searchTerminals(terminals, '')).toEqual([])
    expect(searchTerminals(terminals, '   ')).toEqual([])
  })

  it('matches apostrophes and ampersands via the space-less haystack', () => {
    expect(ids(searchTerminals(terminals, 'sons'))).toEqual([13])
    expect(ids(searchTerminals(terminals, "samson & son's"))).toEqual([13])
  })

  it('matches location names (planet, moon, system, city)', () => {
    expect(ids(searchTerminals(terminals, 'wala'))).toEqual([13])
    expect(ids(searchTerminals(terminals, 'pyro'))).toEqual([14])
    expect(ids(searchTerminals(terminals, 'yela')).sort()).toEqual([15, 16])
  })

  describe('ranking', () => {
    const fixture = [
      terminal(1, {
        name: 'Zeta Substring Hub',
        displayname: 'Zeta Substring Hub',
        nickname: 'ZSH',
        code: 'ZSH1',
      }),
      terminal(2, {
        name: 'Word Start',
        displayname: 'The Alpha Station',
        nickname: 'TAS',
        code: 'TAS1',
      }),
      terminal(3, { name: 'Prefix', displayname: 'Alpha Prime', nickname: 'AP', code: 'APRM' }),
      terminal(4, { name: 'Exact', displayname: 'Beta Place', nickname: 'ALPHA', code: 'BETA' }),
      terminal(5, { name: 'Sub', displayname: 'Megalphabet', nickname: 'MEGA', code: 'MEGA' }),
      terminal(6, {
        name: 'Another prefix',
        displayname: 'Alpha Base',
        nickname: 'AB',
        code: 'ABAS',
      }),
    ]

    it('orders exact code/nickname > prefix > word start > substring, then alphabetically', () => {
      expect(ids(searchTerminals(fixture, 'alpha'))).toEqual([4, 6, 3, 2, 5])
    })

    it('ranks an exact code first', () => {
      expect(ids(searchTerminals(fixture, 'beta'))[0]).toBe(4)
      expect(ids(searchTerminals(fixture, 'aprm'))[0]).toBe(3)
    })
  })

  it('caps results at 12 by default', () => {
    const many = Array.from({ length: 30 }, (_, i) => terminal(i + 1, { displayname: `Hub ${i}` }))
    expect(searchTerminals(many, 'hub')).toHaveLength(12)
    expect(searchTerminals(many, 'hub', 5)).toHaveLength(5)
  })

  it('memoizes the search index per terminal list', () => {
    expect(ids(searchTerminals(terminals, 'arc'))).toEqual(ids(searchTerminals(terminals, 'arc')))
  })
})

describe('searchVehicles', () => {
  it('matches on name_full and ranks prefix matches first', () => {
    expect(vehicles.length).toBeGreaterThan(0)
    expect(searchVehicles(vehicles, 'cutlass black')[0].nameFull).toBe('Drake Cutlass Black')
    expect(searchVehicles(vehicles, 'hull').map((v) => v.id)).toEqual([101, 102])
  })

  it('finds by any token order and short name', () => {
    expect(ids(searchVehicles(vehicles, 'black cutlass')).slice(0, 1)).toEqual([100])
    expect(ids(searchVehicles(vehicles, 'kraken'))).toEqual([103])
  })

  it('returns nothing for an empty or unmatched query', () => {
    expect(searchVehicles(vehicles, '')).toEqual([])
    expect(searchVehicles(vehicles, 'zzzz')).toEqual([])
  })

  it('ranks word-start matches before substring matches', () => {
    const list = [
      { ...vehicles[0], id: 1, nameFull: 'Xhull Thing', name: 'Xhull' },
      { ...vehicles[0], id: 2, nameFull: 'Big Hull', name: 'Big Hull' },
    ]
    expect(ids(searchVehicles(list, 'hull'))).toEqual([2, 1])
  })

  it('limits results', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      ...vehicles[0],
      id: i + 1,
      nameFull: `Ship ${i}`,
    }))
    expect(searchVehicles(many, 'ship')).toHaveLength(12)
  })
})
