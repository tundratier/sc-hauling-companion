import type { AcceptedStop, StopOrigin } from './types'

/**
 * Split a route into its fixed stops and the accepted dynamic stops with the fixed stop each one
 * follows (§6.7). `origins` is parallel to `stops`; a missing entry counts as `fixed`.
 */
export function splitRoute(
  stops: readonly number[],
  origins: readonly StopOrigin[],
): { fixed: number[]; accepted: AcceptedStop[] } {
  const fixed: number[] = []
  const accepted: AcceptedStop[] = []
  stops.forEach((terminalId, i) => {
    if (origins[i] === 'dynamic') accepted.push({ terminalId, afterFixed: fixed.length - 1 })
    else fixed.push(terminalId)
  })
  return { fixed, accepted }
}
