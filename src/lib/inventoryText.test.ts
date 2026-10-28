import { describe, expect, it } from 'vitest'
import type { Haul } from '../calc/types'
import { NO_FLAGS } from '../calc/types'
import { buyOffer, commodity, sellOffer } from '../test-utils/calcFixtures'
import { activeWarnings, describeWarning, reportedSummary } from './inventoryText'

const NOW_MS = 1_800_000_000_000

const haul = (over: Partial<Haul> = {}): Haul =>
  ({
    id: '0-1-1',
    commodity: commodity(1),
    buyOffer: buyOffer(1, 1, 100, { dateModified: NOW_MS / 1000 - 9 * 3600 }),
    sellOffer: sellOffer(1, 2, 150, { dateModified: NOW_MS / 1000 - 45 * 60 }),
    reported: { buyStatus: 1, scuBuy: 0, sellStatus: 7, scuSell: 12, scuSellStock: 3 },
    flags: { ...NO_FLAGS },
    ...over,
  }) as Haul

describe('activeWarnings', () => {
  it('lists active inventory warnings in display order', () => {
    const h = haul({ flags: { ...NO_FLAGS, noStock: true, lowDemand: true, illegal: true } })
    expect(activeWarnings(h)).toEqual(['noStock', 'lowDemand'])
    expect(activeWarnings(haul())).toEqual([])
    expect(
      activeWarnings(haul({ flags: { ...NO_FLAGS, lowStock: true, noDemand: true } })),
    ).toEqual(['lowStock', 'noDemand'])
  })
})

describe('describeWarning', () => {
  it('describes stock warnings with the reported values and their age', () => {
    expect(describeWarning('noStock', haul(), NOW_MS)).toBe(
      'Reported 9 h ago at the buy stop: stock Out of Stock (0–14 %), 0 SCU. Inventory may have refilled since.',
    )
  })

  it('describes demand warnings including reported SCU', () => {
    expect(describeWarning('noDemand', haul(), NOW_MS)).toBe(
      'Reported 45 min ago at the sell stop: demand Maximum, No Demand, 12 SCU reported. Demand may have changed since.',
    )
  })

  it('handles missing status values', () => {
    const h = haul({
      reported: { buyStatus: null, scuBuy: 5, sellStatus: null, scuSell: null, scuSellStock: 0 },
    })
    expect(describeWarning('lowStock', h, NOW_MS)).toContain('stock unknown, 5 SCU')
    expect(describeWarning('lowDemand', h, NOW_MS)).toContain('demand unknown.')
  })
})

describe('reportedSummary', () => {
  it('abbreviates statuses and labels SCU values', () => {
    expect(reportedSummary(haul())).toEqual({ buy: 'OS · 0 SCU', sell: 'ND · 12 SCU · stock 3' })
  })

  it('omits unreported values', () => {
    const h = haul({
      reported: {
        buyStatus: null,
        scuBuy: 41,
        sellStatus: null,
        scuSell: null,
        scuSellStock: 4608,
      },
    })
    expect(reportedSummary(h)).toEqual({ buy: '41 SCU', sell: 'stock 4,608' })
  })
})
