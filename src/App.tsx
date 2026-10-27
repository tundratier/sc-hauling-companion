import { Header } from './components/Header'
import { TabBar, panelId, tabId } from './components/TabBar'
import { useAppStore } from './state/useAppStore'
import { RouteView } from './views/RouteView'
import { ShipView } from './views/ShipView'
import { TradesView } from './views/TradesView'

export default function App() {
  const tab = useAppStore((s) => s.tab)
  const setTab = useAppStore((s) => s.setTab)

  return (
    <div className="app">
      <Header />
      <main className="app-main" id={panelId(tab)} role="tabpanel" aria-labelledby={tabId(tab)}>
        {tab === 'ship' && <ShipView />}
        {tab === 'route' && <RouteView />}
        {tab === 'trades' && <TradesView />}
      </main>
      <TabBar tab={tab} onChange={setTab} />
    </div>
  )
}
