import { useAppStore } from '../state/useAppStore'

export const PRICE_AGE_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'Any age' },
  { value: 1, label: '1 day' },
  { value: 3, label: '3 days' },
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
]

/**
 * The trade filters (SPEC §7.4a), first section of EN ROUTE: illegal, quantum-volatile, hide low
 * stock & demand and the maximum price age. Same settings and persisted keys as before they
 * moved from SHIP. They apply to every trade: TRADES, the stopover comparison and suggestions.
 */
export function TradeFilters() {
  const app = useAppStore()
  return (
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
        <span>Hide low stock &amp; demand</span>
      </label>
      <p className="muted fineprint">
        Hides trades where the buy terminal reports low or no stock, or the sell terminal low or no
        demand — for stress-free hauling
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
  )
}
