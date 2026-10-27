import type { Haul } from '../calc'
import type { Terminal } from '../domain/types'
import { formatAgeDays, formatBoxes, formatInt, formatPercent } from '../lib/format'
import { reportedSummary } from '../lib/inventoryText'
import { HaulBadges, InventoryWarnings, LegalityBadge } from './Badges'

interface HaulCardProps {
  haul: Haul
  terminalById: Map<number, Terminal>
  stops: number[]
  freeScu: number
  now: number
}

/** Short terminal name for route summaries: nickname, then displayname. */
export const shortName = (terminal: Terminal | undefined, id?: number): string =>
  terminal?.nickname || terminal?.displayname || `#${id ?? '?'}`

function Field({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="field" title={title}>
      <span className="label">{label}</span>
      <span className="num">{value}</span>
    </div>
  )
}

/** One single-haul option (result set A). */
export function HaulCard({ haul, terminalById, stops, freeScu, now }: HaulCardProps) {
  const from = shortName(terminalById.get(stops[haul.from]), stops[haul.from])
  const to = shortName(terminalById.get(stops[haul.to]), stops[haul.to])
  const reported = reportedSummary(haul)
  return (
    <article className="haul panel" aria-label={`${haul.commodity.name} ${from} to ${to}`}>
      <header className="haul__head">
        <h4 className="haul__name">{haul.commodity.name}</h4>
        <div className="badges">
          <LegalityBadge illegal={haul.flags.illegal} />
          <HaulBadges haul={haul} />
        </div>
      </header>
      <p className="haul__route">
        <span className="num">{haul.from + 1}</span> {from} →{' '}
        <span className="num">{haul.to + 1}</span> {to}
      </p>

      <div className="fields">
        <Field label="Buy / SCU" value={formatInt(haul.unitBuy)} />
        <Field label="Sell / SCU" value={formatInt(haul.unitSell)} />
        <Field label="Margin / SCU" value={formatInt(haul.margin)} />
        <Field label="Quantity" value={`${formatInt(haul.qtyMax)} of ${formatInt(freeScu)} SCU`} />
      </div>
      <p className="num muted haul__boxes">
        □ {haul.boxSizes.join('·')} — {formatBoxes(haul.boxes)}
      </p>

      <div className="fields">
        <Field label="Investment" value={formatInt(haul.investment)} />
        <div className="field field--profit">
          <span className="label">Profit</span>
          <span className="num num--primary">{formatInt(haul.profit)}</span>
        </div>
        <Field label="ROI" value={formatPercent(haul.roi)} />
        <Field
          label="Price age"
          value={`buy ${formatAgeDays(haul.buyAgeDays)} · sell ${formatAgeDays(haul.sellAgeDays)}`}
        />
      </div>

      <p className="num muted haul__reported">
        Reported — buy: {reported.buy} · sell: {reported.sell}
      </p>
      <div className="badges">
        <InventoryWarnings haul={haul} nowMs={now} />
      </div>
    </article>
  )
}
