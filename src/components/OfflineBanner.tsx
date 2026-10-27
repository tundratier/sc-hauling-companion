import { formatClock } from '../lib/format'
import { useDataStore } from '../state/useDataStore'

/** Non-blocking banner shown when a refresh failed and cached data is used. */
export function OfflineBanner() {
  const error = useDataStore((s) => s.offlineError)
  const fetchedAt = useDataStore((s) => s.prices?.fetchedAt ?? s.staticData?.fetchedAt)
  if (!error) return null
  return (
    <div className="banner banner--warn" role="status">
      Offline{fetchedAt ? ` — showing data from ${formatClock(fetchedAt)}` : ''} ({error.message})
    </div>
  )
}
