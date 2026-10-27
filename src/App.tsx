import { useEffect } from 'react'
import { AppHeader } from './components/AppHeader'
import { OfflineBanner } from './components/OfflineBanner'
import { TabBar, panelId, tabId } from './components/TabBar'
import { useAppStore } from './state/useAppStore'
import { useDataStore } from './state/useDataStore'
import { RouteView } from './views/RouteView'
import { ShipView } from './views/ShipView'
import { TradesView } from './views/TradesView'

export default function App() {
  const tab = useAppStore((s) => s.tab)
  const setTab = useAppStore((s) => s.setTab)
  const liveVersion = useDataStore((s) => s.staticData?.gameVersion)

  // Startup: cached static data first, revalidated in the background.
  useEffect(() => {
    void useDataStore.getState().initStatic()
  }, [])

  // Prices are only fetched when TRADES is opened (and only if missing or expired).
  useEffect(() => {
    if (tab === 'trades' && liveVersion !== undefined) void useDataStore.getState().ensurePrices()
  }, [tab, liveVersion])

  // No refetch while hidden: catch up when the tab becomes visible again.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const data = useDataStore.getState()
      void data.initStatic()
      if (useAppStore.getState().tab === 'trades') void data.ensurePrices()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  return (
    <div className="app">
      <AppHeader />
      <main className="app-main" id={panelId(tab)} role="tabpanel" aria-labelledby={tabId(tab)}>
        <div className="stack">
          <OfflineBanner />
          {tab === 'ship' && <ShipView />}
          {tab === 'route' && <RouteView />}
          {tab === 'trades' && <TradesView />}
        </div>
      </main>
      <TabBar tab={tab} onChange={setTab} />
    </div>
  )
}
