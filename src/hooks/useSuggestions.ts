import { useEffect, useMemo, useState } from 'react'
import { loadTerminalMap, type LoadedMap } from '../api/terminalMap'
import type { SuggestResult } from '../route/suggest'
import { getSuggestClient } from '../route/suggest/suggestClient'
import { useAppStore } from '../state/useAppStore'
import { useDataStore } from '../state/useDataStore'
import { useSuggestUi } from '../state/useSuggestUi'
import { useCalcSettings } from './useTrades'

export const SUGGEST_DEBOUNCE_MS = 300

export type SuggestionState =
  | { status: 'off' }
  /** Enabled, but something is missing: why. */
  | { status: 'blocked'; reason: string }
  | { status: 'searching'; map: MapInfo | null }
  | { status: 'none'; bestFound: boolean; map: MapInfo }
  | { status: 'ready'; result: SuggestResult; map: MapInfo }

export interface MapInfo {
  fileVersion: string
  /** The file is older than the LIVE game version ("map from 4.10.2"). */
  older: boolean
}

type MapState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; map: LoadedMap }
  | { status: 'error'; message: string }

/**
 * Route suggestions for the ROUTE view (§6.7, §7.4). Loads the terminal map lazily when the
 * option is on, makes sure prices are loaded, and recomputes — debounced, in a Web Worker, only
 * the latest request counts — whenever the route, the options, the calc inputs, the dismissals
 * or the data change. Suggestions are proposals only; nothing here edits the route.
 */
export function useSuggestions(): SuggestionState {
  const stops = useAppStore((s) => s.stops)
  const options = useAppStore((s) => s.suggest)
  const dismissed = useSuggestUi((s) => s.dismissed)
  const resetDismissed = useSuggestUi((s) => s.reset)
  const { calc } = useCalcSettings()
  const staticData = useDataStore((s) => s.staticData)
  const prices = useDataStore((s) => s.prices)
  const pricesStatus = useDataStore((s) => s.pricesStatus)
  const ensurePrices = useDataStore((s) => s.ensurePrices)
  const liveVersion = staticData?.gameVersion ?? null

  const [mapState, setMapState] = useState<MapState>({ status: 'idle' })
  const [outcome, setOutcome] = useState<{ key: object; value: SuggestionState } | null>(null)

  const wanted = options.enabled && stops.length >= 2

  // Dismissals last until the route is cleared.
  useEffect(() => {
    if (stops.length === 0) resetDismissed()
  }, [stops.length, resetDismissed])

  // Prices are needed for the profits; they are loaded the same lazy way as on TRADES.
  useEffect(() => {
    if (wanted && !prices && pricesStatus === 'idle') void ensurePrices()
  }, [wanted, prices, pricesStatus, ensurePrices])

  // The terminal map is fetched lazily, the first time the feature is on.
  useEffect(() => {
    if (!wanted || !staticData) return undefined
    let cancelled = false
    setMapState((s) => (s.status === 'ready' ? s : { status: 'loading' }))
    loadTerminalMap(liveVersion).then(
      (map) => !cancelled && setMapState({ status: 'ready', map }),
      (e: unknown) =>
        !cancelled &&
        setMapState({
          status: 'error',
          message: e instanceof Error ? e.message : 'Could not load the terminal map.',
        }),
    )
    return () => {
      cancelled = true
    }
  }, [wanted, staticData, liveVersion])

  const ready =
    wanted && staticData !== null && prices !== null && mapState.status === 'ready'
      ? { map: mapState.map, terminals: staticData.data, offers: prices.data.offers }
      : null

  // Identity of the current inputs: a result only counts for the inputs it was computed for.
  const readyMap = ready?.map
  const readyData = ready?.terminals
  const readyOffers = ready?.offers
  const signature = useMemo(
    () => ({}),
    // oxlint-disable-next-line react/exhaustive-deps
    [stops, calc, options, dismissed, readyMap, readyData, readyOffers],
  )

  // The search itself: debounced, latest request only.
  useEffect(() => {
    if (!ready) return undefined
    const key = signature
    let cancelled = false
    const timer = setTimeout(() => {
      void getSuggestClient()
        .run({
          request: {
            fixed: stops,
            calc,
            options,
            dismissed,
            nowSec: Math.floor(Date.now() / 1000),
          },
          terminals: ready.terminals.terminals,
          commodities: ready.terminals.commodities,
          offers: ready.offers,
          map: ready.map.data,
        })
        .then((result) => {
          if (cancelled || result === null) return
          const map: MapInfo = { fileVersion: ready.map.fileVersion, older: ready.map.older }
          setOutcome({
            key,
            value:
              result.kind === 'ok'
                ? { status: 'ready', result: result.result, map }
                : result.kind === 'none'
                  ? { status: 'none', bestFound: result.bestFound, map }
                  : { status: 'blocked', reason: result.reason },
          })
        })
    }, SUGGEST_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // `ready` is rebuilt every render; `signature` changes exactly when one of its parts does
    // oxlint-disable-next-line react/exhaustive-deps
  }, [signature])

  if (!options.enabled) return { status: 'off' }
  if (stops.length < 2) return { status: 'blocked', reason: 'Add at least two stops first.' }
  if (!staticData) return { status: 'blocked', reason: 'Ships and terminals are not loaded yet.' }
  if (!prices) {
    return {
      status: 'blocked',
      reason:
        pricesStatus === 'error'
          ? 'Prices could not be loaded.'
          : 'Prices are not loaded yet — loading them now…',
    }
  }
  if (mapState.status === 'error') return { status: 'blocked', reason: mapState.message }
  if (mapState.status !== 'ready') {
    return { status: 'searching', map: null }
  }
  const map: MapInfo = { fileVersion: mapState.map.fileVersion, older: mapState.map.older }
  return outcome?.key === signature ? outcome.value : { status: 'searching', map }
}
