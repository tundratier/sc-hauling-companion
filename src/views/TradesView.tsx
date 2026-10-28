import { useMemo, useState } from 'react'
import { buildStaticIndexes } from '../api/indexes'
import { groupByStop, type DroppedCounts, type HaulSortKey } from '../calc'
import { DataGate } from '../components/DataGate'
import { StopSection } from '../components/StopSection'
import { useTrades } from '../hooks/useTrades'
import { boxRangeText, formatAgeMs, formatClock, formatInt } from '../lib/format'
import { shortName } from '../lib/terminalNames'
import { useAppStore } from '../state/useAppStore'
import { useDataStore } from '../state/useDataStore'
import { canComplete, clampTrip, inProgress, onBoard } from '../trip/tripReducer'

const SORTS: { key: HaulSortKey; label: string }[] = [
  { key: 'profit', label: 'Profit' },
  { key: 'roi', label: 'ROI' },
  { key: 'margin', label: 'Margin / SCU' },
  { key: 'investment', label: 'Investment' },
]

/** Why trades are missing: counted by reason (box size, illegal, volatile, price age). */
export function droppedLines(d: DroppedCounts): string[] {
  const lines: string[] = []
  if (d.boxTooLarge > 0)
    lines.push(
      `${d.boxTooLarge} trade${d.boxTooLarge === 1 ? '' : 's'} need bigger boxes than your ship takes`,
    )
  if (d.boxTooSmall > 0)
    lines.push(
      `${d.boxTooSmall} trade${d.boxTooSmall === 1 ? ' only comes' : 's only come'} in boxes smaller than your minimum`,
    )
  if (d.illegal > 0) lines.push(`${d.illegal} hidden by the illegal-commodities filter`)
  if (d.volatileQt > 0) lines.push(`${d.volatileQt} hidden by the quantum-volatile filter`)
  if (d.priceAge > 0) lines.push(`${d.priceAge} hidden by the price-age filter`)
  return lines
}

function TradesContent() {
  const { input, result, vehicle, ready, now } = useTrades()
  const setTab = useAppStore((s) => s.setTab)
  const staticData = useDataStore((s) => s.staticData!.data)
  const prices = useDataStore((s) => s.prices)
  const pricesStatus = useDataStore((s) => s.pricesStatus)
  const pricesError = useDataStore((s) => s.pricesError)
  const ensurePrices = useDataStore((s) => s.ensurePrices)
  const [sort, setSort] = useState<HaulSortKey>('profit')
  const rawTrip = useAppStore((s) => s.trip)
  const toggleBought = useAppStore((s) => s.toggleBought)
  const departStop = useAppStore((s) => s.departStop)
  const undoDepart = useAppStore((s) => s.undoDepart)
  const completeRoute = useAppStore((s) => s.completeRoute)
  const trip = clampTrip(rawTrip, input.stops.length)

  const { terminalById } = useMemo(
    () => buildStaticIndexes(staticData.commodities, staticData.terminals),
    [staticData],
  )
  const byStop = useMemo(
    () => (sort === 'profit' ? result.byStop : groupByStop(result.hauls, input.stops.length, sort)),
    [result, sort, input.stops.length],
  )

  const routeText = input.stops.map((id) => shortName(terminalById.get(id), id)).join(' → ')
  const dropped = droppedLines(result.dropped)
  const board = onBoard(trip)

  const summary = (
    <section className="panel stack" aria-label="Summary">
      <p className="trades__route">{routeText || 'No route yet'}</p>
      <p className="num muted">
        Free cargo {formatInt(input.freeScu)} SCU ·{' '}
        {vehicle ? vehicle.nameFull : 'no ship selected'} · boxes{' '}
        {boxRangeText(input.boxRange.min, input.boxRange.max)} SCU
      </p>
      {input.stops.length >= 2 && (
        <p className="num trades__progress">
          AT STOP {trip.currentStop + 1} OF {input.stops.length}
        </p>
      )}
      {board.length > 0 && (
        <p className="num">
          <span className="label">On board:</span>{' '}
          {board.map((b) => `${b.commodityName} → #${b.sellStop + 1}`).join(', ')}
        </p>
      )}
      {prices && (
        <p className="num muted" aria-live="polite">
          Prices updated {formatClock(prices.fetchedAt)} · {formatAgeMs(now - prices.fetchedAt)} ago
          {prices.stale && ' · refreshing…'}
        </p>
      )}
    </section>
  )

  if (input.stops.length < 2) {
    return (
      <>
        {summary}
        <div className="panel stack">
          <p>Add at least two stops to see trades along your route.</p>
          <button type="button" className="btn btn--primary" onClick={() => setTab('route')}>
            Go to ROUTE
          </button>
        </div>
      </>
    )
  }

  if (!ready) {
    return (
      <>
        {summary}
        {pricesStatus === 'error' ? (
          <div className="panel stack" role="alert">
            <p className="warn">
              Could not load prices{pricesError ? `: ${pricesError.message}` : ''}.
            </p>
            <button type="button" className="btn btn--primary" onClick={() => void ensurePrices()}>
              Retry
            </button>
          </div>
        ) : (
          <div className="panel" role="status">
            <p className="muted">Loading prices…</p>
          </div>
        )}
      </>
    )
  }

  const droppedNote =
    dropped.length > 0 ? (
      <ul className="dropped muted" aria-label="Trades not shown">
        {dropped.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    ) : null

  // With no trades the empty state replaces the lists — unless a trip is in progress, whose
  // reminders and bought lines must stay visible after a price refresh.
  if (result.hauls.length === 0 && !inProgress(trip)) {
    return (
      <>
        {summary}
        <div className="panel stack" role="status">
          <p>No profitable trades along this route.</p>
          {droppedNote}
        </div>
      </>
    )
  }

  return (
    <>
      {summary}
      {droppedNote && <div className="panel">{droppedNote}</div>}
      {result.hauls.length === 0 && (
        <p className="panel muted" role="status">
          No profitable trades along this route any more — your trip progress is kept.
        </p>
      )}

      <div className="row row--wrap">
        <p className="muted grow">
          Buy options at each stop — {formatInt(result.hauls.length)} in total
        </p>
        <div>
          <label className="label" htmlFor="haul-sort">
            Sort by
          </label>
          <select
            id="haul-sort"
            className="input"
            value={sort}
            onChange={(e) => setSort(SORTS.find((s) => s.key === e.target.value)?.key ?? 'profit')}
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="stack">
        {input.stops.map((terminalId, index) => (
          <StopSection
            // stops are positions: the same terminal can appear more than once
            key={`${index}-${terminalId}`}
            index={index}
            stopCount={input.stops.length}
            terminalId={terminalId}
            options={byStop[index] ?? []}
            terminalById={terminalById}
            stops={input.stops}
            freeScu={input.freeScu}
            minBox={input.boxRange.min}
            now={now}
            trip={trip}
            onToggle={toggleBought}
            onDepart={departStop}
            onUndo={undoDepart}
          />
        ))}
        {canComplete(trip, input.stops.length) && (
          <button type="button" className="btn btn--primary btn--block" onClick={completeRoute}>
            Complete route ✓
          </button>
        )}
      </div>
    </>
  )
}

export function TradesView() {
  return (
    <section className="view" aria-labelledby="trades-title">
      <h2 id="trades-title" className="view-title">
        Trades
      </h2>
      <DataGate>
        <TradesContent />
      </DataGate>
    </section>
  )
}
