import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BoxRangeSlider, maxIndexFor } from './BoxRangeSlider'

const minSlider = () => screen.getByRole('slider', { name: 'Minimum box size' })
const maxSlider = () => screen.getByRole('slider', { name: 'Maximum box size' })
const texts = (nodes: NodeListOf<Element>) => [...nodes].map((e) => e.textContent)

describe('BoxRangeSlider', () => {
  it('has two keyboard-usable range inputs with readable values', () => {
    render(<BoxRangeSlider min={4} max={16} accepted={null} onChange={() => {}} />)
    expect(minSlider()).toHaveAttribute('aria-valuetext', '4 SCU')
    expect(maxSlider()).toHaveAttribute('aria-valuetext', '16 SCU')
    expect(minSlider()).toHaveAttribute('max', '6')
  })

  it('reports snapped sizes through onChange and keeps min ≤ max', () => {
    const onChange = vi.fn<(min: number, max: number) => void>()
    render(<BoxRangeSlider min={4} max={16} accepted={null} onChange={onChange} />)
    fireEvent.change(maxSlider(), { target: { value: '5' } })
    expect(onChange).toHaveBeenLastCalledWith(4, 24)
    fireEvent.change(maxSlider(), { target: { value: '0' } })
    expect(onChange).toHaveBeenLastCalledWith(4, 4)
    fireEvent.change(minSlider(), { target: { value: '6' } })
    expect(onChange).toHaveBeenLastCalledWith(16, 16)
  })

  it("caps the max handle at the ship's largest size and dims unaccepted ticks", () => {
    const onChange = vi.fn<(min: number, max: number) => void>()
    const { container } = render(
      <BoxRangeSlider min={4} max={16} accepted={[1, 2, 4, 8, 16]} onChange={onChange} />,
    )
    fireEvent.change(maxSlider(), { target: { value: '6' } })
    expect(onChange).toHaveBeenLastCalledWith(4, 16)
    expect(texts(container.querySelectorAll('.range__tick--disabled'))).toEqual(['24', '32'])
  })

  it('shows tick labels for every step and highlights the selected range', () => {
    const { container } = render(
      <BoxRangeSlider min={2} max={8} accepted={null} onChange={() => {}} />,
    )
    expect(texts(container.querySelectorAll('.range__tick'))).toEqual([
      '1',
      '2',
      '4',
      '8',
      '16',
      '24',
      '32',
    ])
    expect(texts(container.querySelectorAll('.range__tick--on'))).toEqual(['2', '4', '8'])
  })

  it('computes the max index from the ship sizes (unknown = all)', () => {
    expect(maxIndexFor(null)).toBe(6)
    expect(maxIndexFor([])).toBe(6)
    expect(maxIndexFor([1, 2, 4, 8, 16])).toBe(4)
  })
})

describe('BoxRangeSlider pointer dragging', () => {
  const setup = (min = 4, max = 16, accepted: number[] | null = null) => {
    const onChange = vi.fn<(min: number, max: number) => void>()
    const { container } = render(
      <BoxRangeSlider min={min} max={max} accepted={accepted} onChange={onChange} />,
    )
    const track = container.querySelector<HTMLElement>('.range')!
    track.getBoundingClientRect = () => new DOMRect(0, 0, 344, 76) // 300 px between the handle centers
    return { track, onChange }
  }
  const x = (index: number) => 22 + (300 * index) / 6

  it('moves the nearest handle to the pointer and keeps following while dragging', () => {
    const { track, onChange } = setup()
    fireEvent.pointerDown(track, { button: 0, clientX: x(5), pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith(4, 24) // nearer to max (16)
    fireEvent.pointerMove(track, { clientX: x(6), pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith(4, 32)
    fireEvent.pointerUp(track, { pointerId: 1 })
    fireEvent.pointerMove(track, { clientX: x(0), pointerId: 1 })
    expect(onChange).toHaveBeenCalledTimes(2) // no drag after release
  })

  it('moves the min handle when the pointer is nearer to it', () => {
    const { track, onChange } = setup()
    fireEvent.pointerDown(track, { button: 0, clientX: x(0), pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith(1, 16)
  })

  it('picks the max handle on a tie to the right and the min handle on a tie to the left', () => {
    const { track, onChange } = setup(4, 4)
    fireEvent.pointerDown(track, { button: 0, clientX: x(5), pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith(4, 24)
    fireEvent.pointerUp(track, { pointerId: 1 })
    fireEvent.pointerDown(track, { button: 0, clientX: x(0), pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith(1, 4)
  })

  it("never drags the max handle past the ship's largest box", () => {
    const { track, onChange } = setup(4, 16, [1, 2, 4, 8, 16])
    fireEvent.pointerDown(track, { button: 0, clientX: x(6), pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith(4, 16)
  })

  it('ignores non-primary buttons and moves without a drag', () => {
    const { track, onChange } = setup()
    fireEvent.pointerDown(track, { button: 2, clientX: x(5), pointerId: 1 })
    fireEvent.pointerMove(track, { clientX: x(5), pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled()
  })
})
