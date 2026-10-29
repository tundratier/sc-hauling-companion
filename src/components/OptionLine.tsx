import { useId, useState, type ReactNode } from 'react'
import type { Haul, StopoverLeg } from '../calc'
import type { Terminal } from '../domain/types'
import { formatAgeDays, formatInt, formatPercent, formatSigned } from '../lib/format'
import { activeWarnings, describeWarning, reportedSummary } from '../lib/inventoryText'
import { shortName } from '../lib/terminalNames'
import { Badges, MAX_COLLAPSED_BADGES, haulBadges } from './Badges'

interface OptionLineProps {
  haul: Haul
  terminalById: Map<number, Terminal>
  stops: number[]
  freeScu: number
  /** Selected minimum box size (for the "unused SCU" hint). */
  minBox: number
  now: number
  /** Marked as bought (trip mode). */
  bought?: boolean
  /** Present only at the current stop: tapping the line toggles "bought". */
  onToggle?: () => void
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      <span className="num">{value}</span>
    </div>
  )
}

/** `2×16 + 1×8 + 1×4 = 4 boxes` */
export function boxBreakdown(haul: Haul): string {
  const parts = haul.boxes.map((b) => `${b.count}×${b.size}`).join(' + ')
  return `${parts} = ${haul.boxCount} box${haul.boxCount === 1 ? '' : 'es'}`
}

/** The stops a haul passes without selling, 1-based: "#2" or "#2–#4". */
export function skippedStops(haul: Haul): string {
  const first = haul.from + 2
  return haul.to === first ? `#${first}` : `#${first}–#${haul.to}`
}

/** The chain's trades as stop paths, 1-based: "#4 → #5", "#2 → #3 → #5", "#2 → #3, #4 → #5". */
export function chainPath(legs: StopoverLeg[]): string {
  const paths: number[][] = []
  for (const leg of legs) {
    const last = paths[paths.length - 1]
    if (last && last[last.length - 1] === leg.from) last.push(leg.to)
    else paths.push([leg.from, leg.to])
  }
  return paths.map((p) => p.map((s) => `#${s + 1}`).join(' → ')).join(', ')
}

/**
 * `▲ 4,200 more than #2 → #3` / `▼ 3,100 less than #4 → #5` / `= same as #2 → #3`, or
 * `▲ 4,200 more · no trades via #2–#3` when no skipped stop has a profitable trade.
 */
export function stopoverVerdict(haul: Haul): { text: string; better: boolean | null } | null {
  const cmp = haul.stopovers
  if (!cmp) return null
  const amount = formatInt(Math.abs(cmp.delta))
  if (cmp.legs.length === 0) {
    return { text: `▲ ${amount} more · no trades via ${skippedStops(haul)}`, better: true }
  }
  const path = chainPath(cmp.legs)
  if (cmp.delta === 0) return { text: `= same as ${path}`, better: null }
  const better = cmp.delta > 0
  return {
    text: `${better ? '▲' : '▼'} ${amount} ${better ? 'more' : 'less'} than ${path}`,
    better,
  }
}

/** The collapsed line: a toggle button at the current stop, plain content elsewhere. */
function LineTag({
  toggle,
  bought,
  expanded,
  detailsId,
  onExpand,
  children,
}: {
  toggle?: () => void
  bought: boolean
  expanded: boolean
  detailsId: string
  onExpand: () => void
  children: ReactNode
}) {
  return toggle ? (
    <button type="button" className="option__line" aria-pressed={bought} onClick={toggle}>
      {children}
    </button>
  ) : (
    <button
      type="button"
      className="option__line"
      aria-expanded={expanded}
      aria-controls={detailsId}
      onClick={onExpand}
    >
      {children}
    </button>
  )
}

/**
 * One buy option: commodity (with its allowed box sizes) → sell stop, prices, profit and ROI.
 * At the current stop tapping the line marks it as bought; the DETAILS button opens the
 * details independently (lines that are not toggles also open on a tap of the line body).
 */
export function OptionLine({
  haul,
  terminalById,
  stops,
  freeScu,
  minBox,
  now,
  bought = false,
  onToggle,
}: OptionLineProps) {
  const [open, setOpen] = useState(false)
  // Details are independent of "bought": per line, UI state only, all lines start closed.
  const expanded = open
  const detailsId = useId()
  const sellName = shortName(terminalById.get(stops[haul.to]), stops[haul.to])
  const badges = haulBadges(haul)
  const reported = reportedSummary(haul)
  const verdict = stopoverVerdict(haul)

  return (
    <li className={`option${expanded ? ' option--open' : ''}${bought ? ' option--bought' : ''}`}>
      <div className="option__row">
        <LineTag
          toggle={onToggle}
          bought={bought}
          expanded={expanded}
          detailsId={detailsId}
          onExpand={() => setOpen(!open)}
        >
          <span className="option__name">
            {bought && (
              <span className="option__check" aria-hidden="true">
                ✓{' '}
              </span>
            )}
            <strong>{haul.commodity.name}</strong>{' '}
            <span className="num muted option__boxes" title="Allowed box sizes">
              □ {haul.boxSizes.join('·')}
            </span>
          </span>
          <span className="option__sell">
            <span>
              → <span className="num">#{haul.to + 1}</span> {sellName}
            </span>
            <Badges badges={badges} limit={MAX_COLLAPSED_BADGES} />
          </span>
          <span className="option__prices num">
            <span className="option__price">
              <span className="option__label">BUY</span> {formatInt(haul.unitBuy)}
            </span>{' '}
            <span className="option__label">→</span>{' '}
            <span className="option__price">
              <span className="option__label">SELL</span> {formatInt(haul.unitSell)}{' '}
              <span className="option__label">/SCU</span>
            </span>
          </span>
          <span className="option__profit-cell">
            <span className="num num--primary option__profit">{formatInt(haul.profit)}</span>
            <span className="num option__unit"> aUEC</span>
          </span>
          <span className="num muted option__roi">{formatPercent(haul.roi)}</span>
          {verdict && (
            <span
              className={`num option__via${verdict.better === false ? ' option__via--worse' : ''}`}
            >
              {verdict.text}
            </span>
          )}
        </LineTag>
        <button
          type="button"
          className="option__details-btn"
          aria-expanded={open}
          aria-controls={detailsId}
          aria-label={`${open ? 'Hide details' : 'Details'} for ${haul.commodity.name} to stop ${haul.to + 1}`}
          onClick={(e) => {
            e.stopPropagation()
            setOpen(!open)
          }}
        >
          <span>{open ? 'HIDE' : 'DETAILS'}</span>
          <svg
            className="option__details-icon"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M2 4.25 6 8.25 10 4.25" />
          </svg>
        </button>
      </div>

      {expanded && (
        <div id={detailsId} className="option__details">
          <div className="fields">
            <Field label="Margin / SCU" value={formatInt(haul.margin)} />
            <Field
              label="Quantity"
              value={`${formatInt(haul.qtyMax)} of ${formatInt(freeScu)} SCU`}
            />
          </div>
          {haul.unusedScu > 0 && (
            <p className="muted num">
              {formatInt(haul.unusedScu)} SCU unused · min box {minBox}
            </p>
          )}
          <p className="num muted">
            □ {haul.boxSizes.join('·')} — {boxBreakdown(haul)}
          </p>
          <div className="fields">
            <Field label="Investment" value={formatInt(haul.investment)} />
            <Field label="Revenue" value={formatInt(haul.revenue)} />
            <div className="field field--profit">
              <span className="label">Profit</span>
              <span className="num num--primary">{formatInt(haul.profit)}</span>
            </div>
            <Field label="ROI" value={formatPercent(haul.roi)} />
            <Field label="Legality" value={haul.flags.illegal ? 'ILLEGAL' : 'LEGAL'} />
            <Field
              label="Price age"
              value={`buy ${formatAgeDays(haul.buyAgeDays)} · sell ${formatAgeDays(haul.sellAgeDays)}`}
            />
          </div>
          {haul.stopovers && (
            <div className="option__stopovers">
              <span className="label">Instead of skipping</span>
              {haul.stopovers.legs.length > 0 ? (
                <div className="option__legs num">
                  {haul.stopovers.legs.map((leg) => (
                    <span key={`${leg.from}-${leg.to}`}>
                      #{leg.from + 1} → #{leg.to + 1} {leg.commodityName}{' '}
                      <span className="option__leg-profit">{formatInt(leg.profit)}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="muted">No profitable trade sells at {skippedStops(haul)}.</p>
              )}
              <div className="fields">
                <Field label="Via stops" value={formatInt(haul.stopovers.profit)} />
                <Field label="Skipping" value={formatInt(haul.profit)} />
                <Field label="Difference" value={formatSigned(haul.stopovers.delta)} />
              </div>
            </div>
          )}
          <Badges badges={badges} />
          <p className="num muted option__reported">
            Reported — buy: {reported.buy} · sell: {reported.sell}
          </p>
          {activeWarnings(haul).map((kind) => (
            <p key={kind} className="warn-note" role="note">
              {describeWarning(kind, haul, now)}
            </p>
          ))}
        </div>
      )}
    </li>
  )
}
