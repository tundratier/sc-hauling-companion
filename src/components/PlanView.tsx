import { buildTimeline, type Plan, type TimelineAction } from '../calc'
import type { Terminal } from '../domain/types'
import { formatAgeDays, formatBoxes, formatInt, formatPercent, formatSigned } from '../lib/format'
import { HaulBadges, InventoryWarnings, LegalityBadge } from './Badges'

interface PlanViewProps {
  plan: Plan
  stops: number[]
  terminalById: Map<number, Terminal>
  freeScu: number
  now: number
}

function Kpi({
  label,
  value,
  unit,
  primary,
}: {
  label: string
  value: string
  unit?: string
  primary?: boolean
}) {
  return (
    <div className={`kpi${primary ? ' kpi--primary' : ''}`}>
      <span className="label">{label}</span>
      <span className={`kpi__value num${primary ? ' num--primary' : ''}`}>
        {value}
        {unit && <small> {unit}</small>}
      </span>
    </div>
  )
}

function ActionLine({ action, now }: { action: TimelineAction; now: number }) {
  const haul = action.part.haul
  const buy = action.type === 'buy'
  const age = buy ? haul.buyAgeDays : haul.sellAgeDays
  return (
    <div className={`action action--${action.type}`}>
      <div className="action__main">
        <span className={`action__tag${buy ? '' : ' action__tag--sell'}`}>
          {buy ? 'BUY' : 'SELL'}
        </span>
        <span className="num">
          {formatInt(action.qty)} SCU <strong>{action.commodityName}</strong>
        </span>
        <span className="num muted">@ {formatInt(action.unitPrice)}</span>
        <span className="num">= {formatInt(action.total)}</span>
        {action.profit !== undefined && (
          <span className="num num--primary" title="Profit of this part">
            {formatSigned(action.profit)}
          </span>
        )}
      </div>
      <div className="action__meta">
        {action.boxes && action.boxes.length > 0 && (
          <span className="num muted">boxes {formatBoxes(action.boxes)}</span>
        )}
        <span className="num muted">price {formatAgeDays(age)} old</span>
      </div>
      <div className="badges">
        {buy && <LegalityBadge illegal={haul.flags.illegal} />}
        {buy && <HaulBadges haul={haul} />}
        <InventoryWarnings haul={haul} nowMs={now} side={buy ? 'buy' : 'sell'} />
      </div>
    </div>
  )
}

/** One selected plan: KPI row and the stop-by-stop execution timeline (SPEC §6.6, §7.5). */
export function PlanView({ plan, stops, terminalById, freeScu, now }: PlanViewProps) {
  const timeline = buildTimeline(plan, stops)
  return (
    <div className="stack" data-testid="plan">
      <div className="kpis">
        <Kpi label="Profit" value={formatInt(plan.profit)} unit="aUEC" primary />
        <Kpi label="ROI" value={formatPercent(plan.roi)} />
        <Kpi label="Investment" value={formatInt(plan.investment)} />
        <Kpi label="Capital required" value={formatInt(plan.capitalRequired)} />
        <Kpi label="Peak SCU" value={`${formatInt(plan.peakScu)} / ${formatInt(freeScu)}`} />
      </div>

      <ol className="timeline" aria-label="Execution timeline">
        {timeline.map((stop) => {
          const terminal = terminalById.get(stop.terminalId)
          const name = terminal?.displayname ?? `Unknown terminal (#${stop.terminalId})`
          if (stop.passThrough) {
            return (
              <li key={stop.index} className="tl-stop tl-stop--pass">
                <span className="stop__index num">{stop.index + 1}</span>
                <span className="tl-stop__name">{name}</span>
                <span className="muted num">
                  {stop.onBoardLeaving > 0
                    ? `pass through · ${formatInt(stop.onBoardLeaving)} SCU on board`
                    : 'no trade'}
                </span>
              </li>
            )
          }
          return (
            <li key={stop.index} className="tl-stop">
              <div className="tl-stop__head">
                <span className="stop__index num">{stop.index + 1}</span>
                <div className="stop__text">
                  <div className="stop__primary">{name}</div>
                  {terminal && (
                    <div className="stop__secondary">
                      {[terminal.name, terminal.starSystemName].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
              </div>
              {stop.actions.map((action, i) => (
                <ActionLine key={`${action.type}-${i}`} action={action} now={now} />
              ))}
              <div className="tl-stop__foot num muted">
                {formatInt(stop.onBoardLeaving)} SCU on board when leaving
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
