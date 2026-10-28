import { useEffect, useState } from 'react'

/** Current time in ms; ticks every `intervalMs` only while `active` (no polling otherwise). */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = active ? setInterval(() => setNow(Date.now()), intervalMs) : undefined
    return () => clearInterval(id)
  }, [active, intervalMs])
  return now
}
