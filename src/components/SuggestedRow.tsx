import { terminalDisplay } from '../domain/terminalDisplay'
import type { Terminal } from '../domain/types'
import { shortName } from '../lib/terminalNames'
import type { SuggestResult, SuggestedStop } from '../route/suggest'

interface SuggestedRowProps {
  stop: SuggestedStop
  result: SuggestResult
  byId: Map<number, Terminal>
  onAdd: () => void
  onDismiss: () => void
}

/** What a position of the combined route is called: `#5` for a fixed stop, else its name. */
function routeLabel(result: SuggestResult, byId: Map<number, Terminal>, index: number): string {
  const dynamic = result.stops.find((s) => s.routeIndex === index)
  if (dynamic) return shortName(byId.get(dynamic.terminalId), dynamic.terminalId)
  let fixed = 0
  for (let i = 0; i <= index; i++) {
    if (!result.stops.some((s) => s.routeIndex === i)) fixed++
  }
  return `#${fixed}`
}

/** `buy Quartz → #5` / `sell Waste ← #1` (a stop can do both). */
export function roleText(
  stop: SuggestedStop,
  result: SuggestResult,
  byId: Map<number, Terminal>,
): string {
  const parts: string[] = []
  if (stop.role.buy) {
    parts.push(
      `buy ${stop.role.buy.commodityName} → ${routeLabel(result, byId, stop.role.buy.toIndex)}`,
    )
  }
  if (stop.role.sell) {
    parts.push(
      `sell ${stop.role.sell.commodityName} ← ${routeLabel(result, byId, stop.role.sell.fromIndex)}`,
    )
  }
  return parts.join(' · ')
}

/** A suggested stop inside the route list: dashed, no number, handle or reorder buttons. */
export function SuggestedRow({ stop, result, byId, onAdd, onDismiss }: SuggestedRowProps) {
  const terminal = byId.get(stop.terminalId)
  const display = terminal ? terminalDisplay(terminal) : undefined
  const name = display?.primary ?? `Unknown terminal (#${stop.terminalId})`
  return (
    <li className="stop stop--suggested" data-suggested={stop.terminalId}>
      <span className="badge badge--dim stop__tag">SUGGESTED</span>
      <div className="stop__text">
        <div className="stop__primary">{name}</div>
        {display?.secondary && <div className="stop__secondary">{display.secondary}</div>}
        <div className="stop__role">{roleText(stop, result, byId)}</div>
      </div>
      <div className="stop__actions">
        <button type="button" className="btn btn--primary" onClick={onAdd}>
          Add
        </button>
        <button
          type="button"
          className="btn"
          aria-label={`Dismiss ${name}`}
          title="Do not suggest this terminal again"
          onClick={onDismiss}
        >
          ✕
        </button>
      </div>
    </li>
  )
}
