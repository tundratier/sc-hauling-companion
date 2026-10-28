import { useSyncExternalStore } from 'react'
import {
  enterFullscreen,
  exitFullscreen,
  isFullscreen,
  isFullscreenSupported,
  onFullscreenChange,
} from '../lib/fullscreen'
import { Icon } from './Icon'

/**
 * Header toggle for the Fullscreen API. Follows the real state (Esc and system gestures
 * included), is not persisted, and is not rendered where full screen is unavailable.
 */
export function FullscreenButton() {
  const active = useSyncExternalStore(onFullscreenChange, () => isFullscreen())
  if (!isFullscreenSupported()) return null
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
