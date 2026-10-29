import { create } from 'zustand'

/** UI-only state of "add profitable stops": dismissed terminals (not persisted, SPEC §7.4). */
interface SuggestUiState {
  dismissed: number[]
  dismiss: (terminalId: number) => void
  /** Forget all dismissals (the route was cleared). */
  reset: () => void
}

export const useSuggestUi = create<SuggestUiState>()((set) => ({
  dismissed: [],
  dismiss: (terminalId) =>
    set((s) =>
      s.dismissed.includes(terminalId) ? s : { dismissed: [...s.dismissed, terminalId] },
    ),
  reset: () => set((s) => (s.dismissed.length === 0 ? s : { dismissed: [] })),
}))
