import { useState } from 'react'
import { refreshCooldownRemainingMs } from '../api/dataStore'
import { useNow } from '../hooks/useNow'
import { statusText } from '../lib/status'
import { useDataStore } from '../state/useDataStore'
import { Header } from './Header'

/** Header wired to the data store: status pill and "Refresh prices" (60 s cooldown). */
export function AppHeader() {
  const prices = useDataStore((s) => s.prices)
  const staticData = useDataStore((s) => s.staticData)
  const refreshing = useDataStore((s) => s.refreshing)
  const refreshPrices = useDataStore((s) => s.refreshPrices)
  const offline = useDataStore((s) => s.offlineError)
  // Tick every second only while the refresh cooldown runs, otherwise every 30 s.
  const [fast, setFast] = useState(false)
  const now = useNow(true, fast ? 1000 : 30_000)
  const cooldown = prices ? refreshCooldownRemainingMs(prices.fetchedAt, now) > 0 : false
  if (cooldown !== fast) setFast(cooldown)

  return (
    <Header
      status={statusText(prices, staticData, now)}
      statusWarn={!!offline}
      onRefresh={() => void refreshPrices()}
      refreshDisabled={refreshing || cooldown}
      refreshing={refreshing}
    />
  )
}
