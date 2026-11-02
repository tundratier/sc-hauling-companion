import { useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Icon } from '../components/Icon'

/** At most one update check per hour when the app becomes visible again (docs/SPEC.md §5.5). */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

/**
 * Registers the service worker (production builds only) and announces a waiting new version.
 * RELOAD activates it and reloads; inputs, route and trip persist in localStorage.
 */
export function UpdateBanner() {
  const [dismissed, setDismissed] = useState(false)
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined)
  const lastCheck = useRef(0)
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      registration.current = reg
    },
  })

  useEffect(() => {
    // the browser checks on start-up itself; that counts as the last check
    lastCheck.current = Date.now()
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (!registration.current || now - lastCheck.current < UPDATE_CHECK_INTERVAL_MS) return
      lastCheck.current = now
      // offline or a failing server: just try again after the next interval
      registration.current.update().catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  if (!needRefresh || dismissed) return null
  return (
    <div className="banner banner--update row" role="status">
      <span className="grow">New version ready</span>
      <button
        type="button"
        className="btn btn--primary"
        onClick={() => void updateServiceWorker(true)}
      >
        RELOAD
      </button>
      <button
        type="button"
        className="btn btn--icon"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        <Icon name="close" />
      </button>
    </div>
  )
}
