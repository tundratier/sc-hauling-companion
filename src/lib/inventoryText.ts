import type { Haul } from '../calc/types'
import { BUY_STATUS, SELL_STATUS, type InventoryWarningKind } from '../domain/inventory'
import { formatAgeLong, formatInt } from './format'

/** Active inventory warnings of a haul, in display order. */
export function activeWarnings(haul: Haul): InventoryWarningKind[] {
  const f = haul.flags
  const out: InventoryWarningKind[] = []
  if (f.noStock) out.push('noStock')
  if (f.lowStock) out.push('lowStock')
  if (f.noDemand) out.push('noDemand')
  if (f.lowDemand) out.push('lowDemand')
  return out
}

/**
 * Explanation shown when a warning badge is tapped, e.g.
 * "Reported 9 h ago: stock Out of Stock (0–14 %), 0 SCU. Inventory may have refilled since."
 */
export function describeWarning(kind: InventoryWarningKind, haul: Haul, nowMs: number): string {
  const { reported } = haul
  if (kind === 'noStock' || kind === 'lowStock') {
    const age = formatAgeLong(nowMs - haul.buyOffer.dateModified * 1000)
    const status = reported.buyStatus ? BUY_STATUS[reported.buyStatus]?.label : 'unknown'
    return `Reported ${age} ago at the buy stop: stock ${status}, ${formatInt(reported.scuBuy)} SCU. Inventory may have refilled since.`
  }
  const age = formatAgeLong(nowMs - haul.sellOffer.dateModified * 1000)
  const status = reported.sellStatus ? SELL_STATUS[reported.sellStatus]?.label : 'unknown'
  const sold = reported.scuSell ? `, ${formatInt(reported.scuSell)} SCU reported` : ''
  return `Reported ${age} ago at the sell stop: demand ${status}${sold}. Demand may have changed since.`
}

/** One-line reported inventory for the single-hauls cards (labelled "reported"). */
export function reportedSummary(haul: Haul): { buy: string; sell: string } {
  const r = haul.reported
  const buyStatus = r.buyStatus ? BUY_STATUS[r.buyStatus]?.abbr : null
  const buy = `${buyStatus ? `${buyStatus} · ` : ''}${formatInt(r.scuBuy)} SCU`
  const parts: string[] = []
  if (r.sellStatus) parts.push(SELL_STATUS[r.sellStatus]?.abbr ?? '?')
  if (r.scuSell) parts.push(`${formatInt(r.scuSell)} SCU`)
  parts.push(`stock ${formatInt(r.scuSellStock)}`)
  return { buy, sell: parts.join(' · ') }
}
