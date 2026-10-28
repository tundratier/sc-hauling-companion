import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NumberStepper, stepForTick } from './NumberStepper'

function Harness({
  initial = 10,
  min = 1,
  max = 500,
}: {
  initial?: number
  min?: number
  max?: number
}) {
  return <Controlled initial={initial} min={min} max={max} />
}

import { useState } from 'react'
function Controlled({ initial, min, max }: { initial: number; min: number; max: number }) {
  const [value, setValue] = useState(initial)
  return <NumberStepper label="Free" value={value} min={min} max={max} onChange={setValue} />
}

const input = () => screen.getByLabelText<HTMLInputElement>('Free')

describe('NumberStepper long press', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('steps once on press, then repeats and accelerates while held', () => {
    render(<Harness />)
    const plus = screen.getByRole('button', { name: 'Increase Free' })
    fireEvent.pointerDown(plus, { button: 0 })
    expect(input().value).toBe('11')
    act(() => {
      vi.advanceTimersByTime(399)
    })
    expect(input().value).toBe('11') // still within the hold delay
    act(() => {
      vi.advanceTimersByTime(1 + 90 * 20)
    })
    expect(Number(input().value)).toBeGreaterThan(11 + 20) // accelerated beyond +1 per tick
    fireEvent.pointerUp(plus)
    const settled = input().value
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(input().value).toBe(settled)
  })

  it('stops at the limit and never keeps running', () => {
    render(<Harness initial={497} max={500} />)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Increase Free' }), { button: 0 })
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(input().value).toBe('500')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('holds the decrease button down to the minimum', () => {
    render(<Harness initial={30} />)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Decrease Free' }), { button: 0 })
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(input().value).toBe('1')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops when the pointer leaves or is cancelled', () => {
    render(<Harness />)
    const plus = screen.getByRole('button', { name: 'Increase Free' })
    fireEvent.pointerDown(plus, { button: 0 })
    fireEvent.pointerLeave(plus)
    expect(vi.getTimerCount()).toBe(0)
    fireEvent.pointerDown(plus, { button: 0 })
    fireEvent.pointerCancel(plus)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores non-primary buttons', () => {
    render(<Harness />)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Increase Free' }), { button: 2 })
    expect(input().value).toBe('10')
  })

  it('clears the timer on unmount', () => {
    const { unmount } = render(<Harness />)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Increase Free' }), { button: 0 })
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('NumberStepper keyboard and typing', () => {
  it('steps with arrow keys and keyboard-activated buttons', () => {
    render(<Harness />)
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(input().value).toBe('11')
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(input().value).toBe('9')
    fireEvent.click(screen.getByRole('button', { name: 'Increase Free' })) // detail 0 = keyboard
    expect(input().value).toBe('10')
    fireEvent.click(screen.getByRole('button', { name: 'Decrease Free' }))
    expect(input().value).toBe('9')
  })

  it('accepts typed values on blur, clamps, and ignores empty input', () => {
    render(<Harness />)
    fireEvent.change(input(), { target: { value: '9999' } })
    fireEvent.blur(input())
    expect(input().value).toBe('500')
    fireEvent.change(input(), { target: { value: '' } })
    fireEvent.blur(input())
    expect(input().value).toBe('500')
    fireEvent.change(input(), { target: { value: '12abc' } })
    fireEvent.blur(input())
    expect(input().value).toBe('12')
  })
})

describe('stepForTick', () => {
  it('accelerates', () => {
    expect([0, 7, 8, 19, 20, 39, 40, 500].map(stepForTick)).toEqual([1, 1, 5, 5, 25, 25, 100, 100])
  })
})
