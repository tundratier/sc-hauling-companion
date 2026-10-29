import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SUGGEST_OPTIONS } from '../route/suggest/types'
import { INITIAL_TRIP } from '../trip/tripReducer'
import { STORAGE_KEY, useAppStore } from './useAppStore'

const s = () => useAppStore.getState()

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useAppStore.setState({ stops: [10, 11, 12] })
})

describe('accepting suggested stops', () => {
  it('inserts a stop as a normal stop at its position', () => {
    s().insertStop(1, 99)
    expect(s().stops).toEqual([10, 99, 11, 12])
    s().insertStop(0, 98)
    s().insertStop(100, 97) // clamped to the end
    expect(s().stops).toEqual([98, 10, 99, 11, 12, 97])
  })

  it('replaces the whole list (add all) and respects the 10-stop limit', () => {
    s().replaceStops([10, 20, 11, 30, 12])
    expect(s().stops).toEqual([10, 20, 11, 30, 12])
    s().replaceStops(Array.from({ length: 11 }, (_, i) => i + 1))
    expect(s().stops).toEqual([10, 20, 11, 30, 12])
  })

  it('does not insert beyond 10 stops', () => {
    useAppStore.setState({ stops: Array.from({ length: 10 }, (_, i) => i + 1) })
    s().insertStop(2, 99)
    expect(s().stops).toHaveLength(10)
    expect(s().stops).not.toContain(99)
  })

  it('resets trip progress like every route edit, but not when nothing changes', () => {
    s().departStop()
    expect(s().trip.currentStop).toBe(1)
    s().replaceStops([10, 11, 12])
    expect(s().trip.currentStop).toBe(1)
    s().insertStop(1, 99)
    expect(s().trip).toEqual(INITIAL_TRIP)
    s().departStop()
    s().replaceStops([1, 2])
    expect(s().trip).toEqual(INITIAL_TRIP)
  })
})

describe('suggest options', () => {
  it('start off with the documented defaults', () => {
    expect(s().suggest).toEqual(DEFAULT_SUGGEST_OPTIONS)
    expect(s().suggest).toMatchObject({
      enabled: false,
      perGap: 1,
      total: 4,
      perGroup: 1,
      detourPct: 150,
    })
  })

  it('merge partial updates and clamp them into their ranges', () => {
    s().setSuggestOptions({ enabled: true, perGap: 2 })
    expect(s().suggest).toMatchObject({ enabled: true, perGap: 2, total: 4 })
    s().setSuggestOptions({ total: 99, perGroup: 0, detourPct: 400 })
    expect(s().suggest).toMatchObject({ total: 8, perGroup: 1, detourPct: 300 })
  })

  it('are persisted with the other inputs', () => {
    s().setSuggestOptions({ enabled: true, detourPct: 200 })
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    expect(saved.state.suggest).toMatchObject({ enabled: true, detourPct: 200 })
  })
})
