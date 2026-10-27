import type { ReactNode } from 'react'
import { useDataStore } from '../state/useDataStore'

/** Renders children once static data is available; otherwise a loading / blocking error panel. */
export function DataGate({ children }: { children: ReactNode }) {
  const staticData = useDataStore((s) => s.staticData)
  const status = useDataStore((s) => s.staticStatus)
  const error = useDataStore((s) => s.staticError)
  const initStatic = useDataStore((s) => s.initStatic)

  if (staticData) return <>{children}</>
  if (status === 'error') {
    return (
      <div className="panel stack" role="alert">
        <p className="warn">
          Could not load data from UEX Corp{error ? `: ${error.message}` : ''}.
        </p>
        <p className="muted">No cached data is available yet. Check your connection and retry.</p>
        <button type="button" className="btn btn--primary" onClick={() => void initStatic()}>
          Retry
        </button>
      </div>
    )
  }
  return (
    <div className="panel" role="status">
      <p className="muted">Loading terminals, commodities and ships…</p>
    </div>
  )
}
