import { useId, useState } from 'react'
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

/**
 * One buy option: commodity (with its allowed box sizes) → sell stop, profit and ROI. The
 * whole collapsed line is the touch target; tapping expands the details.
 */
export function OptionLine({ haul, terminalById, stops, freeScu, minBox, now }: OptionLineProps) {
  const [open, setOpen] = useState(false)
  const detailsId = useId()
  const sellName = shortName(terminalById.get(stops[haul.to]), stops[haul.to])
  const badges = haulBadges(haul)
  const reported = reportedSummary(haul)

  return (
    <li className={`option${open ? ' option--open' : ''}`}>
      <button
        type="button"
        className="option__line"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen(!open)}
      >
        <span className="option__main">
          <span className="option__name">
            <strong>{haul.commodity.name}</strong>{' '}
            <span className="num muted option__boxes" title="Allowed box sizes">
              □ {haul.boxSizes.join('·')}
            </span>
          </span>
          <span className="option__sell">
            → <span className="num">#{haul.to + 1}</span> {sellName}
          </span>
          <Badges badges={badges} limit={MAX_COLLAPSED_BADGES} />
        </span>
        <span className="option__money">
          <span className="num num--primary option__profit">{formatInt(haul.profit)}</span>
          <span className="num muted">{formatPercent(haul.roi)}</span>
        </span>
      </button>

      {open && (
        <div id={detailsId} className="option__details">
          <div className="fields">
            <Field label="Buy / SCU" value={formatInt(haul.unitBuy)} />
            <Field label="Sell / SCU" value={formatInt(haul.unitSell)} />
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
