import { create } from 'zustand'

/** The non-standard install prompt event (Chromium); feature-detected, never sniffed. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
}

interface InstallState {
  event: BeforeInstallPromptEvent | null
}

const isInstallEvent = (e: Event): e is BeforeInstallPromptEvent =>
  'prompt' in e && typeof e.prompt === 'function'

export const useInstallStore = create<InstallState>(() => ({ event: null }))

/** True when the app runs as an installed app (display-mode: standalone). */
export const isStandalone = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches

/**
 * Keeps the browser's install prompt for the INSTALL APP button in SHIP. Listens from start-up
 * on (not from the SHIP view), because the event fires once and SHIP may not be on screen.
 * Returns the cleanup function.
 */
export function initInstallPrompt(): () => void {
  const onPrompt = (e: Event) => {
    if (!isInstallEvent(e)) return
    e.preventDefault()
    useInstallStore.setState({ event: e })
  }
  const onInstalled = () => useInstallStore.setState({ event: null })
  window.addEventListener('beforeinstallprompt', onPrompt)
  window.addEventListener('appinstalled', onInstalled)
  return () => {
    window.removeEventListener('beforeinstallprompt', onPrompt)
    window.removeEventListener('appinstalled', onInstalled)
    useInstallStore.setState({ event: null })
  }
}

/** Shows the browser's install dialog. The event is single-use, so it is dropped either way. */
export async function promptInstall(): Promise<void> {
  const { event } = useInstallStore.getState()
  if (!event) return
  try {
    await event.prompt()
  } catch {
    // a rejected prompt (e.g. used twice) leaves nothing to retry with
  } finally {
    useInstallStore.setState({ event: null })
  }
}
