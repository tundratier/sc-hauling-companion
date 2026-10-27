import { Icon } from './Icon'

interface HeaderProps {
  /** Data status pill text, e.g. `PRICES 12m · LIVE 4.10.2`. */
  status?: string
  /** Show a warning style (stale / offline). */
  statusWarn?: boolean
  onRefresh?: () => void
  refreshDisabled?: boolean
  refreshing?: boolean
}

export function Header({
  status,
  statusWarn,
  onRefresh,
  refreshDisabled,
  refreshing,
}: HeaderProps) {
  return (
    <header className="app-header">
      <h1 className="app-title">Hauling Companion</h1>
      {status && (
        <span className={`pill${statusWarn ? ' warn' : ''}`} role="status">
          {status}
        </span>
      )}
      {onRefresh && (
        <button
          type="button"
          className="btn btn--icon"
          onClick={onRefresh}
          disabled={refreshDisabled}
          aria-label="Refresh prices"
          aria-busy={refreshing}
        >
          <Icon name="refresh" />
        </button>
      )}
    </header>
  )
}
