import { describe, expect, it } from 'vitest'
import {
  NOW,
  buyOffer,
  commodity,
  makeData,
  makeInput,
  sellOffer,
  terminal,
} from '../test-utils/calcFixtures'
import { calculate } from '.'

const terminals = [terminal(1), terminal(2), terminal(3), terminal(4)]
const commodities = [1, 2, 3, 4, 5].map((id) => commodity(id))

function run(offers: ReturnType<typeof buyOffer>[], stops: number[]) {
  return calculate(
    makeInput({ stops, freeScu: 10 }),
    makeData({ commodities, terminals, offers }),
    NOW,
  )
}

const haul = (result: ReturnType<typeof run>, id: number, from: number, to: number) =>
  result.hauls.find((h) => h.commodity.id === id && h.from === from && h.to === to)

describe('skip hauls compared with trading via the skipped stops', () => {
  // 10 SCU each: A→D C1 1,100 · A→C C2 600 · C→D C3 400 · A→B C4 200 · B→C C5 300
  const offers = [
    buyOffer(1, 1, 100),
    sellOffer(1, 4, 210),
    buyOffer(2, 1, 100),
    sellOffer(2, 3, 160),
    buyOffer(3, 3, 10),
    sellOffer(3, 4, 50),
    buyOffer(4, 1, 100),
    sellOffer(4, 2, 120),
    buyOffer(5, 2, 10),
    sellOffer(5, 3, 40),
  ]

  it('compares A→C with A→B + B→C (different commodities per leg)', () => {
    const result = run(offers, [1, 2, 3, 4])
    expect(haul(result, 2, 0, 2)?.stopovers).toEqual({
      profit: 500,
      legs: [
        { from: 0, to: 1, commodityName: 'C4', profit: 200 },
        { from: 1, to: 2, commodityName: 'C5', profit: 300 },
      ],
      delta: 100,
    })
  })

  it('picks the best chain over longer skips, which may itself contain a skip', () => {
    const result = run(offers, [1, 2, 3, 4])
    // via B: 200 + (300 + 400) = 900; via C: max(600, 500) + 400 = 1,000
    expect(haul(result, 1, 0, 3)?.stopovers).toEqual({
      profit: 1000,
      legs: [
        { from: 0, to: 2, commodityName: 'C2', profit: 600 },
        { from: 2, to: 3, commodityName: 'C3', profit: 400 },
      ],
      delta: 100,
    })
  })

  it('reports a negative delta when trading via the stops pays more', () => {
    const result = run([...offers, buyOffer(3, 2, 10), sellOffer(3, 3, 100)], [1, 2, 3, 4])
    // B→C now 900 with C3: A→B 200 + B→C 900 = 1,100 beats A→C 600
    expect(haul(result, 2, 0, 2)?.stopovers?.delta).toBe(-500)
  })

  it('counts an empty chain as 0 when no skipped stop has a profitable trade', () => {
    const result = run([buyOffer(1, 1, 100), sellOffer(1, 3, 150)], [1, 2, 3])
    expect(haul(result, 1, 0, 2)?.stopovers).toEqual({ profit: 0, legs: [], delta: 500 })
  })

  it('leaves hauls without skips uncompared', () => {
    const result = run(offers, [1, 2, 3, 4])
    expect(result.hauls.filter((h) => h.skips === 0).map((h) => h.stopovers)).toEqual(
      result.hauls.filter((h) => h.skips === 0).map(() => null),
    )
    expect(result.byStop[0].find((h) => h.skips > 0)?.stopovers).not.toBeNull()
  })
})
