import type { PriceOffer, Vehicle } from '../domain/types'
import { useAppStore } from '../state/useAppStore'
import { useDataStore } from '../state/useDataStore'
import { commodity, terminal } from './calcFixtures'

export const vehicle: Vehicle = {
  id: 100,
  name: 'Cutlass Black',
  nameFull: 'Drake Cutlass Black',
  scu: 46,
  containerSizes: [1, 2, 4, 8, 16],
  isConcept: false,
  isGroundVehicle: false,
  isSpaceship: true,
  padType: 'M',
}

export interface TradesSeed {
  offers: PriceOffer[]
  commodities: ReturnType<typeof commodity>[]
  stops?: number[]
}

/** Put static data, prices and a route into the stores as if everything was loaded. */
export function seedTrades({ offers, commodities, stops = [1, 2, 3] }: TradesSeed) {
  useAppStore.setState({
    stops,
    vehicleId: 100,
    freeScu: 46,
    boxMin: 1,
    boxMax: 16,
    tab: 'trades',
  })
  useDataStore.setState({
    staticData: {
      data: {
        commodities,
        terminals: [
          terminal(1, {
            displayname: 'ARC-L1 Wide Forest Station',
            nickname: 'ARC-L1',
            name: 'Admin - ARC-L1',
          }),
          terminal(2, { displayname: 'Area18', nickname: 'TDD Area 18', name: 'TDD - Area 18' }),
          terminal(3, {
            displayname: 'Lorville',
            nickname: 'CBD Lorville',
            name: 'CBD - Lorville',
          }),
          terminal(4, { displayname: 'Grim HEX', nickname: 'Grim HEX', name: 'Admin - Grim HEX' }),
        ],
        vehicles: [vehicle],
        gameVersions: { live: '4.10.2', ptu: '4.10.3' },
      },
      fetchedAt: Date.now(),
      gameVersion: '4.10.2',
      stale: false,
      error: null,
    },
    staticStatus: 'ready',
    prices: {
      data: { offers },
      fetchedAt: Date.now() - 12 * 60_000,
      gameVersion: '4.10.2',
      stale: false,
      error: null,
    },
    pricesStatus: 'ready',
    pricesError: null,
    offlineError: null,
    refreshing: false,
  })
}

/** Replace only the prices (a refresh) without touching the route or the trip. */
export function setPrices(offers: PriceOffer[]) {
  const prices = useDataStore.getState().prices
  if (prices) useDataStore.setState({ prices: { ...prices, data: { offers } } })
}
