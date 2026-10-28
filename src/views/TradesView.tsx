import { useMemo, useState } from 'react'
import { buildStaticIndexes } from '../api/indexes'
import { groupByStop, type DroppedCounts, type Haul, type HaulSortKey } from '../calc'
import { DataGate } from '../components/DataGate'
import { OptionLine } from '../components/OptionLine'
import type { Terminal } from '../domain/types'
import { useTrades } from '../hooks/useTrades'
import { boxRangeText, formatAgeMs, formatClock, formatInt } from '../lib/format'
import { shortName } from '../lib/terminalNames'
import { useAppStore } from '../state/useAppStore'
import { useDataStore } from '../state/useDataStore'
import { terminalSecondary } from './RouteView'

const TOP_N = 5

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

interface StopSectionProps {
  index: number
  stopCount: number
  terminalId: number
  options: Haul[]
  terminalById: Map<number, Terminal>
  stops: number[]
  freeScu: number
  minBox: number
  now: number
}

/** One stop: its buy options (top 5, "Show N more"), each line naming the sell stop. */
function StopSection({
  index,
  stopCount,
  terminalId,
  options,
  terminalById,
  stops,
  freeScu,
  minBox,
  now,
}: StopSectionProps) {
  const [expanded, setExpanded] = useState(false)
  const terminal = terminalById.get(terminalId)
  const last = index === stopCount - 1
  const visible = expanded ? options : options.slice(0, TOP_N)
  return (
    <section className="stop-section" aria-label={`Stop ${index + 1}`}>
      <header className="stop-section__head">
        <span className="stop__index num">{index + 1}</span>
        <div className="stop__text">
          <h3 className="stop__primary">
            {terminal?.displayname ?? `Unknown terminal (#${terminalId})`}
          </h3>
          {terminal && <div className="stop__secondary">{terminalSecondary(terminal)}</div>}
        </div>
      </header>
      {last ? (
        <p className="muted stop-section__note">Final stop — sell only</p>
      ) : options.length === 0 ? (
        <p className="muted stop-section__note">Nothing profitable to buy here</p>
      ) : (
        <>
          <ul className="options" aria-label={`Buy options at stop ${index + 1}`}>
            {visible.map((haul) => (
              <OptionLine
                key={haul.id}
                haul={haul}
                terminalById={terminalById}
                stops={stops}
                freeScu={freeScu}
                minBox={minBox}
                now={now}
              />
            ))}
          </ul>
          {options.length > TOP_N && (
            <button type="button" className="btn btn--block" onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Show fewer' : `Show ${options.length - TOP_N} more`}
            </button>
          )}
        </>
      )}
    </section>
  )
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

  const summary = (
    <section className="panel stack" aria-label="Summary">
      <p className="trades__route">{routeText || 'No route yet'}</p>
      <p className="num muted">
        Free cargo {formatInt(input.freeScu)} SCU ·{' '}
        {vehicle ? vehicle.nameFull : 'no ship selected'} · boxes{' '}
        {boxRangeText(input.boxRange.min, input.boxRange.max)} SCU
      </p>
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

  if (result.hauls.length === 0) {
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
          />
        ))}
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
