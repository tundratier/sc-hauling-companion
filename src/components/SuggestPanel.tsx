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

/** One-line state of the search (§7.4a). */
export function suggestionStatus(
  state: SuggestionState,
  detourPct: number,
  used = 0,
  total = Number.POSITIVE_INFINITY,
  safeLoadingOnly = false,
): string | null {
  switch (state.status) {
    case 'blocked':
      return state.reason
    case 'searching':
      return 'Searching…'
    case 'none':
      if (used >= total) return `${used} of ${total} dynamic stops used`
      return `No profitable stops within a ${detourPct} % detour${safeLoadingOnly ? ' with safe loading' : ''}${state.bestFound ? ' (best found)' : ''}`
    default:
      return state.result.bestFound ? 'Best found within the time limit' : null
  }
}

/**
 * The four suggestion settings of §6.7 (stops per gap, in total, per planetary group, maximum
 * detour), always visible, and the note when the map is older than LIVE.
 */
export function SuggestSettings({ mapFrom }: { mapFrom: string | null }) {
  const options = useAppStore((s) => s.suggest)
  const setOptions = useAppStore((s) => s.setSuggestOptions)
  return (
    <section className="panel stack" aria-label="Suggestion settings">
      <span className="label">Suggested stops</span>
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
      {mapFrom && <p className="muted fineprint">Map from {mapFrom}</p>}
    </section>
  )
}

interface SuggestSummaryProps {
  state: SuggestionState
  /** Accepted dynamic stops of the route; they use the budget. */
  dynamicCount: number
  onAddAll: (result: SuggestResult) => void
}

/**
 * Under the route list (§7.4a): the search state, the dynamic-stop budget and, when there are
 * suggestions, their summary and ADD ALL.
 */
export function SuggestSummary({ state, dynamicCount, onAddAll }: SuggestSummaryProps) {
  const options = useAppStore((s) => s.suggest)
  const status = suggestionStatus(
    state,
    options.detourPct,
    dynamicCount,
    options.total,
    options.safeLoadingOnly,
  )
  const result = state.status === 'ready' ? state.result : null
  return (
    <section className="panel stack" aria-label="Suggestion summary">
      {status && (
        <p className="muted" role="status">
          {status}
        </p>
      )}
      <p className="muted num" aria-label="Dynamic stop budget">
        dynamic stops {dynamicCount} / {options.total} used
      </p>
      {result && (
        <div className="stack suggest__summary">
          <p className="num">{suggestionSummary(result)}</p>
          <button type="button" className="btn btn--primary" onClick={() => onAddAll(result)}>
            Add all
          </button>
        </div>
      )}
    </section>
  )
}
