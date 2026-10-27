import { useState } from 'react'
import type { Haul } from '../calc/types'
import { STALE_AFTER_DAYS } from '../calc'
import { WARNING_LABEL } from '../domain/inventory'
import { formatAgeDays } from '../lib/format'
import { activeWarnings, describeWarning } from '../lib/inventoryText'

export const LegalityBadge = ({ illegal }: { illegal: boolean }) =>
  illegal ? (
    <span className="badge badge--illegal">ILLEGAL</span>
  ) : (
    <span className="badge badge--ok">LEGAL</span>
  )

/** SKIPS n, STALE nd, VOLATILE, EVENT and box-size uncertainty badges. */
export function HaulBadges({ haul }: { haul: Haul }) {
  const age = Math.max(haul.buyAgeDays ?? 0, haul.sellAgeDays ?? 0)
  return (
    <>
      {haul.skips > 0 && <span className="badge">SKIPS {haul.skips}</span>}
      {haul.flags.stale && (
        <span className="badge badge--warn" title={`Price older than ${STALE_AFTER_DAYS} days`}>
          STALE {formatAgeDays(age)}
        </span>
      )}
      {haul.flags.volatileTime && (
        <span className="badge badge--warn" title="Degrades over time">
          VOLATILE
        </span>
      )}
      {haul.flags.temporary && (
        <span className="badge badge--dim" title="Event commodity">
          EVENT
        </span>
      )}
      {haul.flags.boxSizesUnknown && (
        <span className="badge badge--dim" title="Box sizes unknown for this offer — assumed">
          BOXES ?
        </span>
      )}
    </>
  )
}

/**
 * Inventory warnings (NO/LOW STOCK?, NO/LOW DEMAND?). They are reported, not live, so each
 * badge expands to the reported values and their age. They never hide or demote a trade.
 */
export function InventoryWarnings({
  haul,
  nowMs,
  side,
}: {
  haul: Haul
  nowMs: number
  /** Only the stock warnings (buy stop) or the demand warnings (sell stop); default both. */
  side?: 'buy' | 'sell'
}) {
  const [open, setOpen] = useState<string | null>(null)
  const warnings = activeWarnings(haul).filter(
    (kind) => !side || (side === 'buy') === (kind === 'noStock' || kind === 'lowStock'),
  )
  if (warnings.length === 0) return null
  return (
    <>
      {warnings.map((kind) => (
        <button
          key={kind}
          type="button"
          className="badge badge--warn"
          aria-expanded={open === kind}
          onClick={() => setOpen(open === kind ? null : kind)}
        >
          {WARNING_LABEL[kind]}
        </button>
      ))}
      {warnings.map(
        (kind) =>
          open === kind && (
            <p key={`${kind}-text`} className="warn-note" role="note">
              {describeWarning(kind, haul, nowMs)}
            </p>
          ),
      )}
    </>
  )
}
