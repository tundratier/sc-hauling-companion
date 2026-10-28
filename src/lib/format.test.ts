import { describe, expect, it } from 'vitest'
import { indexAtY } from './drag'
import {
  formatAgeLong,
  formatBoxes,
  formatAgeDays,
  formatAgeMs,
  formatClock,
  formatCompact,
  formatInt,
  formatPercent,
  formatSigned,
} from './format'

describe('number formatting', () => {
  it('groups en-US and rounds', () => {
    expect(formatInt(1234567)).toBe('1,234,567')
    expect(formatInt(0.4)).toBe('0')
    expect(formatInt(2810.6)).toBe('2,811')
  })

  it('compacts large values', () => {
    expect(formatCompact(1_230_000)).toBe('1.23M')
    expect(formatCompact(950)).toBe('950')
  })

  it('formats percentages with one decimal', () => {
    expect(formatPercent(0.1234)).toBe('12.3%')
    expect(formatPercent(0)).toBe('0.0%')
  })

  it('signs profits', () => {
    expect(formatSigned(23230)).toBe('+23,230')
    expect(formatSigned(-1200)).toBe('−1,200')
  })
})

describe('age formatting', () => {
  it('formats compact ages', () => {
    expect(formatAgeMs(30_000)).toBe('now')
    expect(formatAgeMs(-5)).toBe('now')
    expect(formatAgeMs(12 * 60_000)).toBe('12m')
    expect(formatAgeMs(5 * 3_600_000)).toBe('5h')
    expect(formatAgeMs(47 * 3_600_000)).toBe('47h')
    expect(formatAgeMs(9 * 86_400_000)).toBe('9d')
  })

  it('formats day counts and unknown ages', () => {
    expect(formatAgeDays(9.2)).toBe('9d')
    expect(formatAgeDays(0.4)).toBe('9h')
    expect(formatAgeDays(null)).toBe('?')
  })

  it('formats the local clock as HH:MM', () => {
    expect(formatClock(new Date(2026, 9, 27, 7, 5).getTime())).toBe('07:05')
  })
})

describe('indexAtY', () => {
  const rows = [
    { top: 0, bottom: 90 },
    { top: 100, bottom: 190 },
    { top: 200, bottom: 290 },
  ]

  it('finds the row under the pointer', () => {
    expect(indexAtY(rows, 10)).toBe(0)
    expect(indexAtY(rows, 150)).toBe(1)
    expect(indexAtY(rows, 250)).toBe(2)
  })

  it('clamps above, below and in gaps', () => {
    expect(indexAtY(rows, -50)).toBe(0)
    expect(indexAtY(rows, 900)).toBe(2)
    expect(indexAtY(rows, 95)).toBe(2) // gap → last row fallback
  })

  it('returns -1 for no rows', () => {
    expect(indexAtY([], 10)).toBe(-1)
  })
})

describe('formatAgeLong / formatBoxes', () => {
  it('spells out ages', () => {
    expect(formatAgeLong(10_000)).toBe('just now')
    expect(formatAgeLong(12 * 60_000)).toBe('12 min')
    expect(formatAgeLong(9 * 3_600_000)).toBe('9 h')
    expect(formatAgeLong(60 * 3_600_000)).toBe('2 d')
  })

  it('formats box breakdowns', () => {
    expect(
      formatBoxes([
        { size: 16, count: 2 },
        { size: 8, count: 1 },
      ]),
    ).toBe('2×16 · 1×8')
    expect(formatBoxes([])).toBe('')
  })
})
