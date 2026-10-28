import { normalize } from './search'
import type { Terminal } from './types'

export interface TerminalDisplay {
  /** `displayname` (falls back to `name`). */
  primary: string
  /** name (only if it adds information) · planet · moon · system; '' when there is nothing. */
  secondary: string
}

const compact = (normalized: string) => normalized.replaceAll(' ', '')

/**
 * Two-line terminal label used in the route rows, the autocomplete results and TRADES.
 * The secondary line joins `name`, `planet_name`, `moon_name` and `star_system_name`, skipping
 * empty parts and any part that equals, or is contained in, the primary line or an earlier
 * part (so `HDMS-Hahn` shows `Hurston · Magda · Stanton`, not `HDMS-Hahn · Stanton`).
 */
export function terminalDisplay(terminal: Terminal): TerminalDisplay {
  const primary = terminal.displayname || terminal.name
  const seen = [normalize(primary)]
  const parts: string[] = []
  for (const part of [
    terminal.name,
    terminal.planetName,
    terminal.moonName,
    terminal.starSystemName,
  ]) {
    if (!part) continue
    const n = normalize(part)
    if (!n) continue
    const redundant = seen.some((s) => s.includes(n) || compact(s).includes(compact(n)))
    if (redundant) continue
    parts.push(part)
    seen.push(n)
  }
  return { primary, secondary: parts.join(' · ') }
}
