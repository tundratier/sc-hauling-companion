import { useEffect, useId, useRef, useState, type PointerEvent } from 'react'

interface NumberStepperProps {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}

const HOLD_DELAY_MS = 400
const REPEAT_MS = 90

/** Step size grows while a button is held (long-press accelerates). */
export const stepForTick = (tick: number): number =>
  tick < 8 ? 1 : tick < 20 ? 5 : tick < 40 ? 25 : 100

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/** Numeric input with − / + steppers (44 px targets, hold to accelerate). */
export function NumberStepper({ label, value, min, max, onChange }: NumberStepperProps) {
  const uid = useId()
  const [draft, setDraft] = useState<string | null>(null)
  // Latest props for the repeat timer (which outlives a render).
  const latest = useRef({ value, min, max, onChange })
  useEffect(() => {
    latest.current = { value, min, max, onChange }
  })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stop = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => stop, [])

  /** Returns false once a limit is reached (stops the hold-repeat). */
  const step = (dir: 1 | -1, size: number): boolean => {
    const cur = latest.current
    const next = clamp(cur.value + dir * size, cur.min, cur.max)
    if (next === cur.value) return false
    latest.current = { ...cur, value: next }
    cur.onChange(next)
    return true
  }

  const start = (dir: 1 | -1, e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    stop()
    step(dir, 1)
    let tick = 0
    const repeat = () => {
      if (!step(dir, stepForTick(tick++))) return stop()
      timer.current = setTimeout(repeat, REPEAT_MS)
    }
    timer.current = setTimeout(repeat, HOLD_DELAY_MS)
  }

  const commit = (text: string) => {
    setDraft(null)
    const n = Number(text.replace(/[^\d]/g, ''))
    if (text.trim() !== '' && Number.isFinite(n)) onChange(clamp(n, min, max))
  }

  return (
    <div className="stepper">
      <label className="label" htmlFor={`${uid}-input`}>
        {label}
      </label>
      <div className="stepper__row">
        <button
          type="button"
          className="btn btn--icon"
          aria-label={`Decrease ${label}`}
          disabled={value <= min}
          onPointerDown={(e) => start(-1, e)}
          onPointerUp={stop}
          onPointerLeave={stop}
          onPointerCancel={stop}
          onClick={(e) => {
            if (e.detail === 0) step(-1, 1) // keyboard activation
          }}
        >
          −
        </button>
        <input
          id={`${uid}-input`}
          className="input stepper__input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={draft ?? String(value)}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(e.currentTarget.value)
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              step(1, 1)
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              step(-1, 1)
            }
          }}
        />
        <button
          type="button"
          className="btn btn--icon"
          aria-label={`Increase ${label}`}
          disabled={value >= max}
          onPointerDown={(e) => start(1, e)}
          onPointerUp={stop}
          onPointerLeave={stop}
          onPointerCancel={stop}
          onClick={(e) => {
            if (e.detail === 0) step(1, 1)
          }}
        >
          +
        </button>
      </div>
    </div>
  )
}
