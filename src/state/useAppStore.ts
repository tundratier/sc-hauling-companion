import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Tab = 'ship' | 'route' | 'trades'

export const TABS: { id: Tab; label: string }[] = [
  { id: 'ship', label: 'Ship' },
  { id: 'route', label: 'Route' },
  { id: 'trades', label: 'Trades' },
]

/** User input that survives reloads (localStorage key `shc:v1`). */
export interface AppState {
  tab: Tab
  setTab: (tab: Tab) => void
}

export const STORAGE_KEY = 'shc:v1'

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      tab: 'ship',
      setTab: (tab) => set({ tab }),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      partialize: ({ tab }) => ({ tab }),
    },
  ),
)
