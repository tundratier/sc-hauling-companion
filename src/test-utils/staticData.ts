import { vi } from 'vitest'
import commodities from '../__fixtures__/commodities.json'
import gameVersions from '../__fixtures__/gameVersions.json'
import pricesAll from '../__fixtures__/pricesAll.json'
import terminals from '../__fixtures__/terminals.json'
import vehicles from '../__fixtures__/vehicles.json'
import type { Loaded, PriceData, StaticData } from '../api/dataStore'
import {
  mapCommodities,
  mapGameVersions,
  mapPrices,
  mapTerminals,
  mapVehicles,
} from '../api/mappers'
import { useDataStore } from '../state/useDataStore'

/** Mapped fixture data (malformed-record warnings silenced). */
export function fixtureStatic(fetchedAt = Date.now()): Loaded<StaticData> {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const data: StaticData = {
    commodities: mapCommodities(commodities.data),
    terminals: mapTerminals(terminals.data),
    vehicles: mapVehicles(vehicles.data).filter((v) => v.scu > 0),
    gameVersions: mapGameVersions(gameVersions.data),
  }
  warn.mockRestore()
  return { data, fetchedAt, gameVersion: data.gameVersions.live, stale: false, error: null }
}

export function fixturePrices(fetchedAt = Date.now()): Loaded<PriceData> {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const data: PriceData = { offers: mapPrices(pricesAll.data) }
  warn.mockRestore()
  return { data, fetchedAt, gameVersion: '4.10.2', stale: false, error: null }
}

/** Put fixture data into the data store as if it had been loaded. */
export function seedDataStore(opts: { prices?: boolean } = {}) {
  useDataStore.setState({
    staticData: fixtureStatic(),
    staticStatus: 'ready',
    staticError: null,
    prices: opts.prices ? fixturePrices() : null,
    pricesStatus: opts.prices ? 'ready' : 'idle',
    pricesError: null,
    offlineError: null,
    refreshing: false,
  })
}
