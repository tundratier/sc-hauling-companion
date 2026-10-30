import { useCallback, useMemo } from 'react'
import { PRICES_REFRESH_COOLDOWN_MS, refreshCooldownRemainingMs } from '../api/dataStore'
import { Combobox } from '../components/Combobox'
import { DataGate } from '../components/DataGate'
import { NumberStepper } from '../components/NumberStepper'
import { BoxRangeSlider } from '../components/BoxRangeSlider'
import { useNow } from '../hooks/useNow'
import { searchVehicles } from '../domain/search'
import type { Vehicle } from '../domain/types'
import { boxRangeText, formatAgeMs, formatClock, formatInt } from '../lib/format'
import { MAX_FREE_SCU_NO_SHIP, useAppStore } from '../state/useAppStore'
import { useDataStore } from '../state/useDataStore'

const QUICK_PERCENTS = [25, 50, 75, 100]
const PRICE_AGE_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'Any age' },
  { value: 1, label: '1 day' },
  { value: 3, label: '3 days' },
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
]

export const boxesLabel = (v: Vehicle) =>
  v.containerSizes ? `boxes ≤${Math.max(...v.containerSizes)}` : 'boxes unknown'

function ShipForm() {
  const vehicles = useDataStore((s) => s.staticData!.data.vehicles)
  const app = useAppStore()
  const vehicle = useMemo(
    () => vehicles.find((v) => v.id === app.vehicleId) ?? null,
    [vehicles, app.vehicleId],
  )
  const shown = useMemo(
    () => (app.showConceptShips ? vehicles : vehicles.filter((v) => !v.isConcept)),
    [vehicles, app.showConceptShips],
  )
  const search = useCallback((query: string) => searchVehicles(shown, query), [shown])
  const maxScu = vehicle?.scu ?? MAX_FREE_SCU_NO_SHIP
  const freeScu = Math.min(app.freeScu, maxScu)

  return (
    <div className="stack">
      <section className="panel stack" aria-label="Ship">
        <Combobox
          label="Ship"
          placeholder="Search ships, e.g. Cutlass Black"
          search={search}
          getKey={(v) => v.id}
          renderOption={(v) => ({
            primary: v.nameFull,
            secondary: `${formatInt(v.scu)} SCU · ${boxesLabel(v)}`,
          })}
          onSelect={app.selectVehicle}
          value={vehicle?.nameFull ?? ''}
          emptyText="No ship matches"
        />
        {vehicle && (
          <p className="muted num">
            {formatInt(vehicle.scu)} SCU · {boxesLabel(vehicle)}
          </p>
        )}
        <label className="toggle">
          <input
            type="checkbox"
            checked={app.showConceptShips}
            onChange={(e) => app.setShowConceptShips(e.target.checked)}
          />
          <span>Show concept ships</span>
        </label>
      </section>

      <section className="panel stack" aria-label="Free cargo">
        <NumberStepper
          label="Free cargo (SCU)"
          value={freeScu}
          min={1}
          max={maxScu}
          onChange={(n) => app.setFreeScu(n, vehicle?.scu)}
        />
        <div className="seg" role="group" aria-label="Quick cargo fill">
          {QUICK_PERCENTS.map((pct) => (
            <button
              key={pct}
              type="button"
              className="seg__btn num"
              disabled={!vehicle}
              onClick={() =>
                vehicle &&
                app.setFreeScu(Math.max(1, Math.floor((vehicle.scu * pct) / 100)), vehicle.scu)
              }
            >
              {pct} %
            </button>
          ))}
        </div>
      </section>

      <section className="panel stack" aria-label="Box sizes">
        <span className="label">
          Boxes <span className="num">{boxRangeText(app.boxMin, app.boxMax)}</span> SCU
        </span>
        <BoxRangeSlider
          min={app.boxMin}
          max={app.boxMax}
          accepted={vehicle?.containerSizes ?? null}
          onChange={app.setBoxRange}
        />
        {vehicle && !vehicle.containerSizes && (
          <p className="warn">Box sizes for this ship unknown — set the largest box that fits.</p>
        )}
        <label className="toggle">
          <input
            type="checkbox"
            checked={app.smallHangar}
            onChange={(e) => app.setSmallHangar(e.target.checked)}
          />
          <span>Lands in a small hangar (S) — hangar elevators take max 24 SCU boxes</span>
        </label>
        <p className="muted fineprint">
          Outposts always take max 24 SCU; cities and stations without a loading dock too when you
          land in a small hangar.
        </p>
      </section>

      <section className="panel stack" aria-label="Filters">
        <span className="label">Filters</span>
        <label className="toggle">
          <input
            type="checkbox"
            checked={app.includeIllegal}
            onChange={(e) => app.setIncludeIllegal(e.target.checked)}
          />
          <span>Include illegal commodities</span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={app.includeVolatileQt}
            onChange={(e) => app.setIncludeVolatileQt(e.target.checked)}
          />
          <span>Include quantum-volatile commodities</span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={app.hideLowStock}
            onChange={(e) => app.setHideLowStock(e.target.checked)}
          />
          <span>Hide low &amp; no stock</span>
        </label>
        <p className="muted fineprint">
          Hides trades whose reported stock is low or empty — for stress-free hauling
        </p>
        <div>
          <label className="label" htmlFor="max-age">
            Max price age
          </label>
          <select
            id="max-age"
            className="input"
            value={app.maxPriceAgeDays ?? ''}
            onChange={(e) =>
              app.setMaxPriceAgeDays(e.target.value === '' ? null : Number(e.target.value))
            }
          >
            {PRICE_AGE_OPTIONS.map((o) => (
              <option key={o.label} value={o.value ?? ''}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <DataControls />
    </div>
  )
}

function DataControls() {
  const staticData = useDataStore((s) => s.staticData)
  const prices = useDataStore((s) => s.prices)
  const refreshing = useDataStore((s) => s.refreshing)
  const refreshPrices = useDataStore((s) => s.refreshPrices)
  const reloadAll = useDataStore((s) => s.reloadAll)
  const now = useNow(true, 1000)
  const remaining = prices ? refreshCooldownRemainingMs(prices.fetchedAt, now) : 0
  const stamp = (at?: number) => (at ? `${formatClock(at)} (${formatAgeMs(now - at)} ago)` : '—')

  return (
    <section className="panel stack" aria-label="Data">
      <span className="label">Data</span>
      <p className="num muted">Prices: {stamp(prices?.fetchedAt)}</p>
      <p className="num muted">Ships &amp; terminals: {stamp(staticData?.fetchedAt)}</p>
      <div className="row row--wrap">
        <button
          type="button"
          className="btn grow"
          disabled={refreshing || remaining > 0}
          onClick={() => void refreshPrices()}
        >
          Refresh prices
          {remaining > 0 && ` (${Math.ceil(remaining / 1000)}s)`}
        </button>
        <button
          type="button"
          className="btn grow"
          disabled={refreshing}
          onClick={() => void reloadAll()}
        >
          Reload all data
        </button>
      </div>
      <p className="muted fineprint">
        Refresh is limited to once per {PRICES_REFRESH_COOLDOWN_MS / 1000} s — server data updates
        every 30 min anyway.
      </p>
    </section>
  )
}

export function ShipView() {
  return (
    <section className="view" aria-labelledby="ship-title">
      <h2 id="ship-title" className="view-title">
        Ship
      </h2>
      <DataGate>
        <ShipForm />
      </DataGate>
      <footer className="app-footer">
        Data: UEX Corp (uexcorp.space) · community-sourced, may be inaccurate · Not affiliated with
        Cloud Imperium Games.
      </footer>
    </section>
  )
}
