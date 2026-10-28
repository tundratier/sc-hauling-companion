import { STALE_AFTER_DAYS, type Haul } from '../calc'
import { WARNING_LABEL } from '../domain/inventory'
import { formatAgeDays } from '../lib/format'
import { activeWarnings } from '../lib/inventoryText'

export interface BadgeSpec {
  key: string
  label: string
  className: string
  title?: string
}

/**
 * Small, non-interactive chips for a haul (≈ 18–20 px tall): ILLEGAL, SKIPS n, STALE nd,
 * VOLATILE and the reported-inventory warnings (NO/LOW STOCK?, NO/LOW DEMAND?). Warnings
 * never hide or demote a trade; the expanded line explains them.
 */
export function haulBadges(haul: Haul): BadgeSpec[] {
  const age = Math.max(haul.buyAgeDays ?? 0, haul.sellAgeDays ?? 0)
  const badges: BadgeSpec[] = []
  if (haul.flags.illegal)
    badges.push({ key: 'illegal', label: 'ILLEGAL', className: 'badge--illegal' })
  if (haul.skips > 0) badges.push({ key: 'skips', label: `SKIPS ${haul.skips}`, className: '' })
  if (haul.flags.stale) {
    badges.push({
      key: 'stale',
      label: `STALE ${formatAgeDays(age)}`,
      className: 'badge--warn',
      title: `Price older than ${STALE_AFTER_DAYS} days`,
    })
  }
  if (haul.flags.volatileTime) {
    badges.push({
      key: 'volatile',
      label: 'VOLATILE',
      className: 'badge--warn',
      title: 'Degrades over time',
    })
  }
  for (const kind of activeWarnings(haul)) {
    badges.push({
      key: kind,
      label: WARNING_LABEL[kind],
      className: 'badge--warn',
      title: 'Reported, not live',
    })
  }
  if (haul.flags.temporary)
    badges.push({ key: 'event', label: 'EVENT', className: 'badge--dim', title: 'Event commodity' })
  if (haul.flags.boxSizesUnknown) {
    badges.push({
      key: 'boxes',
      label: 'BOXES ?',
      className: 'badge--dim',
      title: 'Box sizes unknown — assumed',
    })
  }
  return badges
}

export const MAX_COLLAPSED_BADGES = 3

/**
 * Badge chips. With `limit`, all badges are rendered but those beyond the limit are hidden on
 * narrow screens (CSS) and replaced by a `+n` chip; pass no limit to list them all.
 */
export function Badges({ badges, limit }: { badges: BadgeSpec[]; limit?: number }) {
  if (badges.length === 0) return null
  const hidden = limit === undefined ? 0 : Math.max(0, badges.length - limit)
  return (
    <span className="badges">
      {badges.map((b, i) => (
        <span
          key={b.key}
          className={`badge ${b.className}${limit !== undefined && i >= limit ? ' badge--extra' : ''}`}
          title={b.title}
        >
          {b.label}
        </span>
      ))}
      {hidden > 0 && <span className="badge badge--dim badge--more">+{hidden}</span>}
    </span>
  )
}
