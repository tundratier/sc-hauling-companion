import { useId, useState, type ReactNode } from 'react'
import type { Haul } from '../calc'
import type { Terminal } from '../domain/types'
import { formatAgeDays, formatInt, formatPercent } from '../lib/format'
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
 * At the current stop tapping the line marks it as bought (and shows its details); elsewhere
 * tapping expands or collapses the details.
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
  // Bought lines at the current stop show their details automatically (unmarking collapses
  // them); lines that are not toggles expand and collapse when tapped.
  const expanded = onToggle ? bought : open
  const detailsId = useId()
  const sellName = shortName(terminalById.get(stops[haul.to]), stops[haul.to])
  const badges = haulBadges(haul)
  const reported = reportedSummary(haul)

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
        </LineTag>
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
