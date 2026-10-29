import { buildPriceIndexes, buildStaticIndexes } from '../../api/indexes'
import type { Commodity, PriceOffer, Terminal } from '../../domain/types'
import type { TerminalMapData } from '../../domain/terminalMap'
import { buildMapIndexes } from './map'
import { suggestStops } from './search'
import type { SuggestOutcome, SuggestRequest } from './types'

/** Everything one search needs, as plain structured-cloneable data (it crosses to a worker). */
export interface SuggestJob {
  request: SuggestRequest
  terminals: Terminal[]
  commodities: Commodity[]
  offers: PriceOffer[]
  map: TerminalMapData
}

/** Build the lookup tables and search. Used by the worker and by the inline fallback. */
export function runSuggest(job: SuggestJob): SuggestOutcome {
  return suggestStops(job.request, {
    terminals: job.terminals,
    data: {
      ...buildStaticIndexes(job.commodities, job.terminals),
      ...buildPriceIndexes(job.offers),
    },
    map: buildMapIndexes(job.map),
  })
}

export interface WorkerRequest {
  id: number
  job: SuggestJob
}

export interface WorkerResponse {
  id: number
  outcome: SuggestOutcome
}
