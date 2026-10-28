/**
 * Fullscreen API helpers with `webkit`-prefixed fallbacks (older iPadOS Safari). Everything is
 * feature-detected — never user-agent sniffing — and failures are swallowed.
 */

const prefixed = (target: object, name: string): unknown => Reflect.get(target, name)

/** Whether the browser lets the page enter full screen (false on iPhone Safari). */
export function isFullscreenSupported(doc: Document = document): boolean {
  return doc.fullscreenEnabled || prefixed(doc, 'webkitFullscreenEnabled') === true
}

/** Whether an element is currently shown full screen. */
export function isFullscreen(doc: Document = document): boolean {
  return Boolean(doc.fullscreenElement) || Boolean(prefixed(doc, 'webkitFullscreenElement'))
}

/** Enter full screen; resolves to false (never rejects) when the request fails. */
export async function enterFullscreen(doc: Document = document): Promise<boolean> {
  const el = doc.documentElement
  try {
    if (typeof el.requestFullscreen === 'function') {
      await el.requestFullscreen({ navigationUI: 'hide' })
      return true
    }
    const fallback = prefixed(el, 'webkitRequestFullscreen')
    if (typeof fallback === 'function') {
      await fallback.call(el)
      return true
    }
  } catch {
    // e.g. a permissions policy in an embedding iframe: stay windowed
  }
  return false
}

/** Leave full screen; resolves to false (never rejects) when it fails. */
export async function exitFullscreen(doc: Document = document): Promise<boolean> {
  try {
    if (typeof doc.exitFullscreen === 'function') {
      await doc.exitFullscreen()
      return true
    }
    const fallback = prefixed(doc, 'webkitExitFullscreen')
    if (typeof fallback === 'function') {
      await fallback.call(doc)
      return true
    }
  } catch {
    // already left or not allowed: nothing to do
  }
  return false
}

/** Subscribe to full screen changes (Esc and system gestures included). */
export function onFullscreenChange(listener: () => void, doc: Document = document): () => void {
  doc.addEventListener('fullscreenchange', listener)
  doc.addEventListener('webkitfullscreenchange', listener)
  return () => {
    doc.removeEventListener('fullscreenchange', listener)
    doc.removeEventListener('webkitfullscreenchange', listener)
  }
}
