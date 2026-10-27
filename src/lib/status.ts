import type { Loaded, PriceData, StaticData } from '../api/dataStore'
import { formatAgeMs } from './format'

/** Header pill text, e.g. `PRICES 12m · LIVE 4.10.2`. */
export function statusText(
  prices: Loaded<PriceData> | null,
  staticData: Loaded<StaticData> | null,
  now: number,
): string {
  const live = staticData?.data.gameVersions.live
  const parts = [prices ? `PRICES ${formatAgeMs(now - prices.fetchedAt)}` : 'NO PRICES']
  if (live) parts.push(`LIVE ${live}`)
  return parts.join(' · ')
}
