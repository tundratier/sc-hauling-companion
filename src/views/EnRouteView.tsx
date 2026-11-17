import { useMemo } from 'react'
import { StopBadges } from '../components/Badges'
import { DataGate } from '../components/DataGate'
import { SuggestSettings, SuggestSummary } from '../components/SuggestPanel'
import { SuggestedRow } from '../components/SuggestedRow'
import { TradeFilters } from '../components/TradeFilters'
import { terminalDisplay } from '../domain/terminalDisplay'
import type { Terminal } from '../domain/types'
import { useSuggestions } from '../hooks/useSuggestions'
import { normalizeOrigins, useAppStore } from '../state/useAppStore'
import { useDataStore } from '../state/useDataStore'
import { useSuggestUi } from '../state/useSuggestUi'

/** A route stop as a compact row: number, terminal, badges; only dynamic stops can be removed. */
function RouteStopRow({
  index,
  terminal,
  terminalId,
  dynamic,
  onRemove,
}: {
  index: number
  terminal: Terminal | undefined
  terminalId: number
  dynamic: boolean
  onRemove: () => void
}) {
  const display = terminal ? terminalDisplay(terminal) : undefined
  return (
    <li className="stop stop--compact">
      <span className="stop__index num">{index + 1}</span>
      <div className="stop__text">
        <div className="stop__primary">
          {display?.primary ?? `Unknown terminal (#${terminalId})`}
        </div>
        {display?.secondary && <div className="stop__secondary">{display.secondary}</div>}
        <StopBadges dynamic={dynamic} safe={terminal?.safeLoading !== false} />
      </div>
      {dynamic && (
        <div className="stop__actions">
          <button
            type="button"
            className="btn btn--danger"
            aria-label={`Remove stop ${index + 1}`}
            onClick={onRemove}
          >
            ✕
          </button>
        </div>
      )}
    </li>
  )
}

function EnRouteContent() {
  const terminals = useDataStore((s) => s.staticData!.data.terminals)
  const stops = useAppStore((s) => s.stops)
  const storedOrigins = useAppStore((s) => s.origins)
  const safeLoadingOnly = useAppStore((s) => s.suggest.safeLoadingOnly)
  const setSuggestOptions = useAppStore((s) => s.setSuggestOptions)
  const insertStop = useAppStore((s) => s.insertStop)
  const replaceStops = useAppStore((s) => s.replaceStops)
  const removeStop = useAppStore((s) => s.removeStop)
  const setTab = useAppStore((s) => s.setTab)
  const dismiss = useSuggestUi((s) => s.dismiss)
  const suggestion = useSuggestions()

  const origins = normalizeOrigins(stops, storedOrigins)
  const byId = useMemo(() => new Map(terminals.map((t) => [t.id, t])), [terminals])
  const suggested = suggestion.status === 'ready' ? suggestion.result : null
  const mapInfo =
    suggestion.status === 'none' ||
    suggestion.status === 'ready' ||
    suggestion.status === 'searching'
      ? suggestion.map
      : null
  const fixedCount = origins.filter((o) => o === 'fixed').length
  const dynamicCount = origins.length - fixedCount

  return (
    <div className="stack">
      <TradeFilters />

      <section className="panel stack" aria-label="Stop filter">
        <span className="label">Stops</span>
        <label className="toggle">
          <input
            type="checkbox"
            checked={safeLoadingOnly}
            onChange={(e) => setSuggestOptions({ safeLoadingOnly: e.target.checked })}
          />
          <span>Safe loading only</span>
        </label>
        <p className="muted fineprint">
          Suggest only armistice zones and station hangars — leaves out Pyro outposts and Stanton
          salvage yards
        </p>
      </section>

      {fixedCount < 2 ? (
        <div className="panel stack">
          <p>Add at least two stops on ROUTE to get suggestions.</p>
          <button type="button" className="btn" onClick={() => setTab('route')}>
            Go to ROUTE
          </button>
        </div>
      ) : (
        <>
          <SuggestSettings mapFrom={mapInfo?.older ? mapInfo.fileVersion : null} />

          <ol className="stops" aria-label="Route with suggestions">
            {stops.flatMap((id, i) => [
              <RouteStopRow
                key={`${i}-${id}`}
                index={i}
                terminal={byId.get(id)}
                terminalId={id}
                dynamic={origins[i] === 'dynamic'}
                onRemove={() => removeStop(i)}
              />,
              ...(suggested?.stops ?? [])
                .filter((s) => s.insertAt === i + 1)
                .sort((a, b) => a.routeIndex - b.routeIndex)
                .map((s) => (
                  <SuggestedRow
                    key={`suggested-${s.terminalId}`}
                    stop={s}
                    result={suggested!}
                    byId={byId}
                    onAdd={() => insertStop(s.insertAt, s.terminalId, 'dynamic')}
                    onDismiss={() => dismiss(s.terminalId)}
                  />
                )),
            ])}
          </ol>

          <SuggestSummary
            state={suggestion}
            dynamicCount={dynamicCount}
            onAddAll={(result) => replaceStops(result.route, result.origins)}
          />
        </>
      )}
    </div>
  )
}

export function EnRouteView() {
  const setTab = useAppStore((s) => s.setTab)
  return (
    <section className="view" aria-labelledby="enroute-title">
      <h2 id="enroute-title" className="view-title">
        En route
      </h2>
      <DataGate>
        <EnRouteContent />
      </DataGate>
      <div className="sticky-action" data-bottom-overlay>
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={() => setTab('trades')}
        >
          Calculate trades →
        </button>
      </div>
    </section>
  )
}
