import { describe, expect, it } from 'vitest'
import { decomposeBoxes, maxFillable } from './boxes'

describe('maxFillable', () => {
  it.each([
    [46, [1, 2, 4, 8, 16], 46],
    [46, [8, 16], 40],
    [7, [8, 16], 0],
    [30, [24], 24],
    [100, [1], 100],
    [100, [32], 96],
    [23, [8, 16], 16],
    [25, [6, 10], 24],
    [5, [6, 10], 0],
  ])('maxFillable(%i, %j) = %i', (cap, sizes, expected) => {
    expect(maxFillable(cap, sizes)).toBe(expected)
  })

  it('handles degenerate input', () => {
    expect(maxFillable(0, [1])).toBe(0)
    expect(maxFillable(-5, [1])).toBe(0)
    expect(maxFillable(10, [])).toBe(0)
    expect(maxFillable(Number.NaN, [1])).toBe(0)
    expect(maxFillable(10.9, [4])).toBe(8)
  })

  it('ignores non-positive and non-integer sizes and is order independent', () => {
    expect(maxFillable(20, [0, -4, 2.5, 8, 16])).toBe(16)
    expect(maxFillable(46, [16, 8])).toBe(maxFillable(46, [8, 16]))
  })

  it('answers growing and shrinking caps for the same size set', () => {
    expect(maxFillable(20, [8, 16])).toBe(16)
    expect(maxFillable(100, [8, 16])).toBe(96)
    expect(maxFillable(20, [8, 16])).toBe(16)
    expect(maxFillable(12_000, [24, 32])).toBe(12_000)
  })

  it('evicts old tables instead of growing without bound', () => {
    for (let i = 2; i < 100; i++) expect(maxFillable(50, [i, i + 1])).toBeGreaterThanOrEqual(0)
    expect(maxFillable(46, [8, 16])).toBe(40)
  })
})

describe('decomposeBoxes', () => {
  const total = (boxes: { size: number; count: number }[]) =>
    boxes.reduce((s, b) => s + b.size * b.count, 0)

  it('decomposes largest-first', () => {
    expect(decomposeBoxes(46, [1, 2, 4, 8, 16])).toEqual([
      { size: 16, count: 2 },
      { size: 8, count: 1 },
      { size: 4, count: 1 },
      { size: 2, count: 1 },
    ])
  })

  it('uses only allowed sizes', () => {
    expect(decomposeBoxes(40, [8, 16])).toEqual([
      { size: 16, count: 2 },
      { size: 8, count: 1 },
    ])
  })

  it('finds a valid decomposition where plain greedy would fail', () => {
    // greedy largest-first on 12 with {4, 6, 8} would take 8 and be stuck at 4 → ok; use 18:
    // 8+8 leaves 2 (stuck); the DP-guided choice is 8+6+4.
    const boxes = decomposeBoxes(18, [4, 6, 8])
    expect(total(boxes)).toBe(18)
    expect(boxes.every((b) => [4, 6, 8].includes(b.size))).toBe(true)
  })

  it('returns [] for 0, unrepresentable quantities and empty size sets', () => {
    expect(decomposeBoxes(0, [8])).toEqual([])
    expect(decomposeBoxes(7, [8, 16])).toEqual([])
    expect(decomposeBoxes(10, [])).toEqual([])
  })

  it('is consistent with maxFillable for many quantities', () => {
    for (const sizes of [
      [1, 2, 4, 8, 16],
      [8, 16],
      [24, 32],
      [4, 24],
      [2, 16, 32],
    ]) {
      for (let cap = 1; cap <= 120; cap += 7) {
        const q = maxFillable(cap, sizes)
        const boxes = decomposeBoxes(q, sizes)
        expect(total(boxes)).toBe(q)
      }
    }
  })
})
