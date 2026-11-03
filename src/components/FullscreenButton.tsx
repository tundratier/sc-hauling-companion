import { useSyncExternalStore } from 'react'
import {
  enterFullscreen,
  exitFullscreen,
  isFullscreen,
  isFullscreenSupported,
  onFullscreenChange,
} from '../lib/fullscreen'
import { isStandalone } from '../pwa/installPrompt'
import { Icon } from './Icon'

/**
 * Header toggle for the Fullscreen API. Follows the real state (Esc and system gestures
 * included), is not persisted, and is not rendered where full screen is unavailable or in the
 * installed app, which already has its own window.
 */
export function FullscreenButton() {
  const active = useSyncExternalStore(onFullscreenChange, () => isFullscreen())
  if (!isFullscreenSupported() || isStandalone()) return null
  const label = active ? 'Exit full screen' : 'Enter full screen'
  return (
    <button
      type="button"
      className="btn btn--icon"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={() => void (active ? exitFullscreen() : enterFullscreen())}
    >
      <Icon name={active ? 'collapse' : 'expand'} />
    </button>
  )
}
