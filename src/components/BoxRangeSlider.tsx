import { useRef, type PointerEvent } from 'react'
import { STD_BOX_SIZES } from '../domain/types'

interface BoxRangeSliderProps {
  min: number
  max: number
  /** Sizes the ship accepts; null = unknown (nothing is disabled). */
  accepted: number[] | null
  onChange: (min: number, max: number) => void
}

const SIZES: readonly number[] = STD_BOX_SIZES
const LAST = SIZES.length - 1

const indexOf = (size: number) => Math.max(0, SIZES.indexOf(size))

/** Largest selectable index for the max handle: the ship's largest accepted size. */
export function maxIndexFor(accepted: number[] | null): number {
  if (!accepted || accepted.length === 0) return LAST
  return indexOf(Math.max(...accepted))
}

/**
 * Dual-handle range slider over the discrete box sizes 1 2 4 8 16 24 32 (evenly spaced,
 * snapping to steps). Two overlaid native range inputs: each handle is a `role="slider"`
 * with arrow-key support and a 44 px hit area.
 */
export function BoxRangeSlider({ min, max, accepted, onChange }: BoxRangeSliderProps) {
  const lo = indexOf(min)
  const hi = indexOf(max)
  const limit = maxIndexFor(accepted)
  const pct = (i: number) => (i / LAST) * 100

  const setMin = (i: number) => onChange(SIZES[Math.min(i, hi)], max)
  const setMax = (i: number) => onChange(min, SIZES[Math.max(Math.min(i, limit), lo)])

  // Pointer handling on the container (the native thumbs are visual only): the handle nearest
  // to the pointer follows it, so overlapping handles and touch drags both work.
  const container = useRef<HTMLDivElement>(null)
  const dragging = useRef<'min' | 'max' | null>(null)
  const indexAt = (clientX: number) => {
    const box = container.current?.getBoundingClientRect()
    if (!box || box.width <= 44) return 0
    const fraction = (clientX - box.left - 22) / (box.width - 44)
    return Math.min(LAST, Math.max(0, Math.round(fraction * LAST)))
  }
  const apply = (handle: 'min' | 'max', i: number) => (handle === 'min' ? setMin(i) : setMax(i))
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const i = indexAt(e.clientX)
    const dMin = Math.abs(i - lo)
    const dMax = Math.abs(i - hi)
    const handle = dMin < dMax ? 'min' : dMax < dMin ? 'max' : i <= lo ? 'min' : 'max'
    dragging.current = handle
    e.currentTarget.setPointerCapture?.(e.pointerId)
    apply(handle, i)
    e.currentTarget
      .querySelector<HTMLInputElement>(`input[data-handle="${handle}"]`)
      ?.focus({ preventScroll: true })
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) apply(dragging.current, indexAt(e.clientX))
  }
  const endDrag = () => {
    dragging.current = null
  }

  return (
    <div
      ref={container}
      className="range"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="range__track" aria-hidden="true">
        <div
          className="range__fill"
          style={{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }}
        />
      </div>
      <input
        type="range"
        className="range__input"
        aria-label="Minimum box size"
        data-handle="min"
        min={0}
        max={LAST}
        step={1}
        value={lo}
        aria-valuetext={`${min} SCU`}
        // when both handles meet in the upper half the min handle must stay reachable
        style={{ zIndex: lo >= LAST / 2 ? 5 : 3 }}
        onChange={(e) => setMin(Number(e.target.value))}
      />
      <input
        type="range"
        className="range__input"
        aria-label="Maximum box size"
        data-handle="max"
        min={0}
        max={LAST}
        step={1}
        value={hi}
        aria-valuetext={`${max} SCU`}
        style={{ zIndex: 4 }}
        onChange={(e) => setMax(Number(e.target.value))}
      />
      <ol className="range__ticks" aria-hidden="true">
        {SIZES.map((size, i) => {
          const disabled = accepted !== null && accepted.length > 0 && !accepted.includes(size)
          const inRange = i >= lo && i <= hi
          return (
            <li
              key={size}
              className={`range__tick num${disabled ? ' range__tick--disabled' : ''}${inRange ? ' range__tick--on' : ''}`}
              style={{ left: `${pct(i)}%` }}
            >
              {size}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
