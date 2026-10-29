import { useState } from 'react'
import type { SuggestionState } from '../hooks/useSuggestions'
import { formatInt, formatSigned } from '../lib/format'
import type { SuggestResult } from '../route/suggest'
import { useAppStore } from '../state/useAppStore'
import { NumberStepper } from './NumberStepper'

const DETOURS = Array.from({ length: 21 }, (_, i) => 100 + i * 10)

/** `+2 stops · route profit 120,000 → 165,000 (+45,000) · distance 40.1 → 52.0 Gm (+30 %)` */
export function suggestionSummary(result: SuggestResult): string {
  const added = result.stops.length
  const parts = [
    `+${added} stop${added === 1 ? '' : 's'}`,
    `route profit ${formatInt(result.profitBefore)} → ${formatInt(result.profitAfter)} (${formatSigned(result.profitAfter - result.profitBefore)})`,
  ]
  const { distanceBefore: d0, distanceAfter: d1 } = result
  const change =
    d0 > 0 ? ` (${d1 >= d0 ? '+' : '−'}${Math.abs(Math.round(((d1 - d0) / d0) * 100))} %)` : ''
  parts.push(`distance ${d0.toFixed(1)} → ${d1.toFixed(1)} Gm${change}`)
  return parts.join(' · ')
}

/** One-line state of the search under the toggle. */
export function suggestionStatus(
  state: SuggestionState,
  detourPct: number,
  used = 0,
  total = Number.POSITIVE_INFINITY,
): string | null {
  switch (state.status) {
    case 'off':
      return null
    case 'blocked':
      return state.reason
    case 'searching':
      return 'Searching…'
    case 'none':
      if (used >= total) return `${used} of ${total} dynamic stops used`
      return `No profitable stops within a ${detourPct} % detour${state.bestFound ? ' (best found)' : ''}`
    default:
      return state.result.bestFound ? 'Best found within the time limit' : null
  }
}

interface SuggestPanelProps {
  state: SuggestionState
  /** Fixed stops of the route (suggestions need at least two). */
  fixedCount: number
  /** Accepted dynamic stops of the route; they use the budget. */
  dynamicCount: number
  onAddAll: (result: SuggestResult) => void
}

/**
 * "Add profitable stops" (SPEC §6.7, §7.4), the last section of ROUTE: the toggle, its four
 * settings (collapsed by default), the dynamic-stop budget, and — when there are suggestions —
 * their summary and ADD ALL. The suggested rows themselves appear inline in the stop list.
 */
export function SuggestPanel({ state, fixedCount, dynamicCount, onAddAll }: SuggestPanelProps) {
  const options = useAppStore((s) => s.suggest)
  const setOptions = useAppStore((s) => s.setSuggestOptions)
  const [open, setOpen] = useState(false)
  const status = suggestionStatus(state, options.detourPct, dynamicCount, options.total)
  const map =
    state.status === 'none' || state.status === 'ready' || state.status === 'searching'
      ? state.map
      : null
  const tooFew = fixedCount < 2
  const result = state.status === 'ready' ? state.result : null

  return (
    <section className="panel stack" aria-label="Add profitable stops">
      <label className="toggle">
        <input
          type="checkbox"
          checked={options.enabled}
          disabled={tooFew}
          onChange={(e) => setOptions({ enabled: e.target.checked })}
        />
        <span className="label suggest__title">Add profitable stops</span>
      </label>
      {tooFew && !options.enabled && <p className="muted">Add at least two stops first.</p>}
      {options.enabled && status && (
        <p className="muted" role="status">
          {status}
        </p>
      )}
      {options.enabled && map?.older && (
        <p className="muted fineprint">Map from {map.fileVersion}</p>
      )}

      <button
        type="button"
        className="btn suggest__settings-btn"
        aria-expanded={open}
        aria-controls="suggest-settings"
        onClick={() => setOpen(!open)}
      >
        {open ? 'Hide settings' : 'Settings'}
      </button>
      {open && (
        <div id="suggest-settings" className="stack">
          <NumberStepper
            label="Stops per gap"
            value={options.perGap}
            min={0}
            max={3}
            onChange={(perGap) => setOptions({ perGap })}
          />
          <NumberStepper
            label="Stops in total"
            value={options.total}
            min={1}
            max={8}
            onChange={(total) => setOptions({ total })}
          />
          <NumberStepper
            label="Stops per planetary group"
            value={options.perGroup}
            min={1}
            max={3}
            onChange={(perGroup) => setOptions({ perGroup })}
          />
          <div>
            <label className="label" htmlFor="suggest-detour">
              Max detour
            </label>
            <select
              id="suggest-detour"
              className="input"
              value={options.detourPct}
              onChange={(e) => setOptions({ detourPct: Number(e.target.value) })}
            >
              {DETOURS.map((p) => (
                <option key={p} value={p}>
                  {p} %
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {options.enabled && !tooFew && (
        <p className="muted num" aria-label="Dynamic stop budget">
          dynamic stops {dynamicCount} / {options.total} used
        </p>
      )}
      {result && (
        <div className="stack suggest__summary" aria-label="Suggestion summary">
          <p className="num">{suggestionSummary(result)}</p>
          <button type="button" className="btn btn--primary" onClick={() => onAddAll(result)}>
            Add all
          </button>
        </div>
      )}
    </section>
  )
}
