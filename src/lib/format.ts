const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 })

/** 1234567 → "1,234,567" (en-US grouping). */
export const formatInt = (n: number): string => integer.format(Math.round(n))

/** 1234567 → "1.23M" — for narrow cards; keep the full value in a title. */
export const formatCompact = (n: number): string => compact.format(n)

/** 0.1234 → "12.3%" (one decimal). */
export const formatPercent = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`

/** Signed integer: +23,230 / −1,200. */
export const formatSigned = (n: number): string => `${n < 0 ? '−' : '+'}${formatInt(Math.abs(n))}`

/** Compact age of a timestamp difference: "now", "12m", "5h", "3d". */
export function formatAgeMs(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** Price age in days (as stored on a haul), e.g. 0.4 → "10h", 9.2 → "9d"; null → "?". */
export function formatAgeDays(days: number | null): string {
  return days === null ? '?' : formatAgeMs(days * 86_400_000)
}

/** Local HH:MM. */
export function formatClock(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
