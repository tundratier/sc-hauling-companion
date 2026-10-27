import type { Commodity, PriceOffer, Terminal } from '../domain/types'

export interface PriceIndexes {
  /** Buy offers (player buys) per terminal. */
  buyOffers: Map<number, PriceOffer[]>
  /** Sell offers (player sells) per terminal, keyed by commodity. */
  sellOffers: Map<number, Map<number, PriceOffer>>
}

export interface StaticIndexes {
  commodityById: Map<number, Commodity>
  terminalById: Map<number, Terminal>
}

const priceCache = new WeakMap<PriceOffer[], PriceIndexes>()
const staticCache = new WeakMap<Terminal[], Map<Commodity[], StaticIndexes>>()

/** Built once per dataset load: memoized on the identity of the offers array. */
export function buildPriceIndexes(offers: PriceOffer[]): PriceIndexes {
  const cached = priceCache.get(offers)
  if (cached) return cached
  const buyOffers = new Map<number, PriceOffer[]>()
  const sellOffers = new Map<number, Map<number, PriceOffer>>()
  for (const offer of offers) {
    if (offer.priceBuy > 0) {
      const list = buyOffers.get(offer.terminalId)
      if (list) list.push(offer)
      else buyOffers.set(offer.terminalId, [offer])
    }
    if (offer.priceSell > 0) {
      let byCommodity = sellOffers.get(offer.terminalId)
      if (!byCommodity) sellOffers.set(offer.terminalId, (byCommodity = new Map()))
      byCommodity.set(offer.commodityId, offer)
    }
  }
  const indexes = { buyOffers, sellOffers }
  priceCache.set(offers, indexes)
  return indexes
}

export function buildStaticIndexes(commodities: Commodity[], terminals: Terminal[]): StaticIndexes {
  let byCommodities = staticCache.get(terminals)
  const cached = byCommodities?.get(commodities)
  if (cached) return cached
  const indexes: StaticIndexes = {
    commodityById: new Map(commodities.map((c) => [c.id, c])),
    terminalById: new Map(terminals.map((t) => [t.id, t])),
  }
  if (!byCommodities) staticCache.set(terminals, (byCommodities = new Map()))
  byCommodities.set(commodities, indexes)
  return indexes
}
