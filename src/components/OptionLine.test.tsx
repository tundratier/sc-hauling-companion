import { describe, expect, it } from 'vitest'
import type { Haul, StopoverComparison, StopoverLeg } from '../calc'
import { chainPath, stopoverVerdict } from './OptionLine'

const leg = (from: number, to: number): StopoverLeg => ({
  from,
  to,
  commodityName: 'Quartz',
  profit: 1,
})

// only the fields the verdict reads
const skipHaul = (from: number, to: number, stopovers: StopoverComparison) =>
  ({ from, to, stopovers }) as Haul

describe('chainPath', () => {
  it('names the stops the chain trades at, not the skipped stops', () => {
    expect(chainPath([leg(3, 4)])).toBe('#4 → #5')
  })

  it('joins consecutive legs into one path and separates gaps', () => {
    expect(chainPath([leg(1, 2), leg(2, 4)])).toBe('#2 → #3 → #5')
    expect(chainPath([leg(1, 2), leg(3, 4)])).toBe('#2 → #3, #4 → #5')
  })
})

describe('stopoverVerdict', () => {
  it('compares #2 → #5 with a chain that only trades #4 → #5', () => {
    const haul = skipHaul(1, 4, { profit: 606_720, legs: [leg(3, 4)], delta: 59_904 })
    expect(stopoverVerdict(haul)).toEqual({ text: '▲ 59,904 more than #4 → #5', better: true })
    const worse = skipHaul(1, 4, { profit: 606_720, legs: [leg(3, 4)], delta: -360_960 })
    expect(stopoverVerdict(worse)).toEqual({ text: '▼ 360,960 less than #4 → #5', better: false })
  })

  it('names the skipped stops when none of them has a profitable trade', () => {
    const haul = skipHaul(0, 3, { profit: 0, legs: [], delta: 12_000 })
    expect(stopoverVerdict(haul)?.text).toBe('▲ 12,000 more · no trades via #2–#3')
  })

  it('returns null for lines without skips', () => {
    expect(stopoverVerdict({ stopovers: null } as Haul)).toBeNull()
  })
})
