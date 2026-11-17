import { create } from 'zustand'

/**
 * UI-only state of "add profitable stops": the terminals dismissed with ✕ (SPEC §7.4a). They
 * count for the current route only — until it is cleared or its fixed stops change — and are
 * never persisted.
 */
interface SuggestUiState {
  dismissed: number[]
  /** Fixed stops (joined ids) the dismissals belong to. */
  routeKey: string
  dismiss: (terminalId: number) => void
  /** The route as seen now: dismissals made for another route are forgotten. */
  forRoute: (routeKey: string) => void
}

export const useSuggestUi = create<SuggestUiState>()((set) => ({
  dismissed: [],
  routeKey: '',
  dismiss: (terminalId) =>
    set((s) =>
      s.dismissed.includes(terminalId) ? s : { dismissed: [...s.dismissed, terminalId] },
    ),
  forRoute: (routeKey) => set((s) => (s.routeKey === routeKey ? s : { dismissed: [], routeKey })),
}))
