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
import { generateCandidates } from './candidates'

type Spec = Parameters<typeof makeData>[0]
type Input = Parameters<typeof makeInput>[0]

const gen = (spec: Spec, input: Input) => generateCandidates(makeInput(input), makeData(spec), NOW)

const base = {
  commodities: [commodity(1)],
  terminals: [terminal(1), terminal(2)],
  offers: [buyOffer(1, 1, 100), sellOffer(1, 2, 150)],
}

const run = (offers: Spec['offers'], boxRange: { min: number; max: number }, freeScu = 46) =>
  gen({ ...base, offers }, { stops: [1, 2], freeScu, boxRange })

describe('box range (min–max)', () => {
  const stdOffers = base.offers

  it('limits B to [min, max]: {4..16} with all sizes offered → {4, 8, 16}', () => {
    const [h] = run(stdOffers, { min: 4, max: 16 }).hauls
    expect(h.boxSizes).toEqual([4, 8, 16])
  })

  it('fills 46 SCU with {4, 8, 16} → 44 SCU and 2 unused', () => {
    const [h] = run(stdOffers, { min: 4, max: 16 }).hauls
    expect(h.qtyMax).toBe(44)
    expect(h.unusedScu).toBe(2)
    expect(h.boxes).toEqual([
      { size: 16, count: 2 },
      { size: 8, count: 1 },
      { size: 4, count: 1 },
    ])
    expect(h.boxCount).toBe(4)
    expect(h.profit).toBe(44 * 50)
  })

  it('has no unused SCU when the range allows 1-SCU boxes', () => {
    const [h] = run(stdOffers, { min: 1, max: 32 }).hauls
    expect(h.unusedScu).toBe(0)
    expect(h.qtyMax).toBe(46)
  })

  it('drops a haul as boxTooSmall when only sizes below the minimum are offered', () => {
    const offers = [buyOffer(1, 1, 100, { containerSizes: [1, 2] }), sellOffer(1, 2, 150)]
    const result = run(offers, { min: 4, max: 32 })
    expect(result.hauls).toEqual([])
    expect(result.dropped).toMatchObject({ boxTooSmall: 1, boxTooLarge: 0 })
  })

  it('drops a haul as boxTooLarge when every offered size is above the maximum', () => {
    const offers = [buyOffer(1, 1, 100, { containerSizes: [16, 32] }), sellOffer(1, 2, 150)]
    const result = run(offers, { min: 1, max: 8 })
    expect(result.hauls).toEqual([])
    expect(result.dropped).toMatchObject({ boxTooLarge: 1, boxTooSmall: 0 })
  })

  it('drops as boxTooLarge when the ship accepts none of the offered sizes', () => {
    const offers = [buyOffer(1, 1, 100, { containerSizes: [16, 32] }), sellOffer(1, 2, 150)]
    const result = gen(
      { ...base, offers },
      { stops: [1, 2], shipBoxSizes: [1, 2, 4], boxRange: { min: 1, max: 32 } },
    )
    expect(result.dropped).toMatchObject({ boxTooLarge: 1, boxTooSmall: 0 })
  })

  it('drops as boxTooLarge when free space is below the smallest allowed box', () => {
    const result = run(stdOffers, { min: 8, max: 32 }, 7)
    expect(result.hauls).toEqual([])
    expect(result.dropped.boxTooLarge).toBe(1)
  })

  it('the sell row container sizes also constrain boxes', () => {
    const offers = [buyOffer(1, 1, 100), sellOffer(1, 2, 150, { containerSizes: [8, 16] })]
    const [h] = run(offers, { min: 1, max: 32 }).hauls
    expect(h.boxSizes).toEqual([8, 16])
    expect(h.qtyMax).toBe(40)
  })

  it('falls back to the sell terminal max box when the sell row has no sizes (flagged)', () => {
    const spec = {
      commodities: [commodity(1)],
      terminals: [terminal(1), terminal(2, { maxContainerSize: 4 })],
      offers: [buyOffer(1, 1, 100), sellOffer(1, 2, 150, { containerSizes: [] })],
    }
    const [h] = gen(spec, { stops: [1, 2] }).hauls
    expect(h.boxSizes).toEqual([1, 2, 4])
    expect(h.flags.boxSizesUnknown).toBe(true)
  })

  it('treats a sell row without sizes and a terminal max of 0 as all standard sizes', () => {
    const spec = {
      commodities: [commodity(1)],
      terminals: [terminal(1), terminal(2, { maxContainerSize: 0 })],
      offers: [buyOffer(1, 1, 100), sellOffer(1, 2, 150, { containerSizes: [] })],
    }
    expect(gen(spec, { stops: [1, 2] }).hauls[0].boxSizes).toEqual([1, 2, 4, 8, 16, 24, 32])
  })
})
