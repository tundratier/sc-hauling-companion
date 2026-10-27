import { useMemo, useState } from 'react'
import { buildStaticIndexes } from '../api/indexes'
import { compareHauls, type DroppedCounts, type HaulSortKey, type Plan } from '../calc'
import { DataGate } from '../components/DataGate'
import { HaulCard, shortName } from '../components/HaulCard'
import { PlanView } from '../components/PlanView'
import { useTrades } from '../hooks/useTrades'
import { formatAgeMs, formatClock, formatInt } from '../lib/format'
import { useAppStore } from '../state/useAppStore'
import { useDataStore } from '../state/useDataStore'

const PAGE_SIZE = 30

const SORTS: { key: HaulSortKey; label: string }[] = [
  { key: 'profit', label: 'Profit' },
  { key: 'roi', label: 'ROI' },
  { key: 'margin', label: 'Margin / SCU' },
  { key: 'investment', label: 'Investment' },
]

/** Why trades are missing: counted by reason (box size, illegal, volatile, price age). */
export function droppedLines(d: DroppedCounts): string[] {
  const lines: string[] = []
  if (d.boxSize > 0)
    lines.push(
      `${d.boxSize} trade${d.boxSize === 1 ? '' : 's'} need bigger boxes than your ship takes`,
    )
  if (d.illegal > 0) lines.push(`${d.illegal} hidden by the illegal-commodities filter`)
  if (d.volatileQt > 0) lines.push(`${d.volatileQt} hidden by the quantum-volatile filter`)
  if (d.priceAge > 0) lines.push(`${d.priceAge} hidden by the price-age filter`)
  return lines
}

const planLabel = (plan: Plan, index: number) =>
  `${index === 0 ? 'MAX' : `#${index + 1}`}${plan.warningCount > 0 ? ` ⚠${plan.warningCount}` : ''}`

function TradesContent() {
  const { input, result, vehicle, ready, now } = useTrades()
  const setTab = useAppStore((s) => s.setTab)
  const staticData = useDataStore((s) => s.staticData!.data)
  const prices = useDataStore((s) => s.prices)
  const pricesStatus = useDataStore((s) => s.pricesStatus)
  const pricesError = useDataStore((s) => s.pricesError)
  const ensurePrices = useDataStore((s) => s.ensurePrices)
  const [planIndex, setPlanIndex] = useState(0)
  const [sort, setSort] = useState<HaulSortKey>('profit')
  const [shown, setShown] = useState(PAGE_SIZE)

  const { terminalById } = useMemo(
    () => buildStaticIndexes(staticData.commodities, staticData.terminals),
    [staticData],
  )
  const sortedHauls = useMemo(
    () => [...result.hauls].sort(compareHauls(sort)),
    [result.hauls, sort],
  )

  const routeText = input.stops.map((id) => shortName(terminalById.get(id), id)).join(' → ')
  const activePlan = Math.min(planIndex, Math.max(0, result.plans.length - 1))
  const plan = result.plans[activePlan]
  const dropped = droppedLines(result.dropped)

  const summary = (
    <section className="panel stack" aria-label="Summary">
      <p className="trades__route">{routeText || 'No route yet'}</p>
      <p className="num muted">
        Free cargo {formatInt(input.freeScu)} SCU ·{' '}
        {vehicle ? vehicle.nameFull : 'no ship selected'}
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

      <section className="stack" aria-labelledby="plans-title">
        <h3 id="plans-title" className="section-title">
          Plans
        </h3>
        <div className="chips" role="tablist" aria-label="Plans">
          {result.plans.map((p, i) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              id={`plan-tab-${i}`}
              aria-selected={i === activePlan}
              aria-controls="plan-panel"
              className="chip"
              onClick={() => setPlanIndex(i)}
            >
              {planLabel(p, i)}
            </button>
          ))}
        </div>
        {plan && (
          <div id="plan-panel" role="tabpanel" aria-labelledby={`plan-tab-${activePlan}`}>
            <PlanView
              plan={plan}
              stops={input.stops}
              terminalById={terminalById}
              freeScu={input.freeScu}
              now={now}
            />
          </div>
        )}
      </section>

      <section className="stack" aria-labelledby="hauls-title">
        <div className="row row--wrap">
          <h3 id="hauls-title" className="section-title grow">
            Single hauls
            <span className="muted num"> · {formatInt(sortedHauls.length)}</span>
          </h3>
          <div>
            <label className="label" htmlFor="haul-sort">
              Sort by
            </label>
            <select
              id="haul-sort"
              className="input"
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as HaulSortKey)
                setShown(PAGE_SIZE)
              }}
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="hauls">
          {sortedHauls.slice(0, shown).map((haul) => (
            <HaulCard
              key={haul.id}
              haul={haul}
              terminalById={terminalById}
              stops={input.stops}
              freeScu={input.freeScu}
              now={now}
            />
          ))}
        </div>
        {sortedHauls.length > shown && (
          <button type="button" className="btn" onClick={() => setShown((n) => n + PAGE_SIZE)}>
            Show more ({formatInt(sortedHauls.length - shown)} left)
          </button>
        )}
      </section>
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
