import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SUGGEST_OPTIONS } from '../route/suggest/types'
import { INITIAL_TRIP } from '../trip/tripReducer'
import { STORAGE_KEY, useAppStore } from './useAppStore'

const s = () => useAppStore.getState()

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useAppStore.setState({ stops: [10, 11, 12], origins: [] })
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
    s().replaceStops([10, 20, 11, 30, 12], [])
    expect(s().stops).toEqual([10, 20, 11, 30, 12])
    s().replaceStops(
      Array.from({ length: 11 }, (_, i) => i + 1),
      [],
    )
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
    s().replaceStops([10, 11, 12], [])
    expect(s().trip.currentStop).toBe(1)
    s().insertStop(1, 99)
    expect(s().trip).toEqual(INITIAL_TRIP)
    s().departStop()
    s().replaceStops([1, 2], [])
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

describe('stop origin (§6.7)', () => {
  const origins = () => s().origins

  it('marks typed stops fixed and accepted ones dynamic', () => {
    useAppStore.setState({ stops: [], origins: [] })
    s().addStop(1)
    s().addStop(2)
    expect(origins()).toEqual(['fixed', 'fixed'])
    s().insertStop(1, 99)
    expect(s().stops).toEqual([1, 99, 2])
    expect(origins()).toEqual(['fixed', 'dynamic', 'fixed'])
    s().insertStop(1, 98, 'fixed')
    expect(origins()).toEqual(['fixed', 'fixed', 'dynamic', 'fixed'])
  })

  it('add all keeps the given origins', () => {
    s().replaceStops([10, 20, 11], ['fixed', 'dynamic', 'fixed'])
    expect(origins()).toEqual(['fixed', 'dynamic', 'fixed'])
    // a missing origin counts as fixed
    s().replaceStops([10, 20, 11, 30], ['fixed', 'dynamic'])
    expect(origins()).toEqual(['fixed', 'dynamic', 'fixed', 'fixed'])
  })

  it('travels with the stop on reorder, reverse and remove', () => {
    s().replaceStops([1, 2, 3, 4], ['fixed', 'dynamic', 'fixed', 'dynamic'])
    s().moveStop(1, 3)
    expect(s().stops).toEqual([1, 3, 4, 2])
    expect(origins()).toEqual(['fixed', 'fixed', 'dynamic', 'dynamic'])
    s().reverseStops()
    expect(s().stops).toEqual([2, 4, 3, 1])
    expect(origins()).toEqual(['dynamic', 'dynamic', 'fixed', 'fixed'])
    s().removeStop(0)
    expect(s().stops).toEqual([4, 3, 1])
    expect(origins()).toEqual(['dynamic', 'fixed', 'fixed'])
    s().clearStops()
    expect(origins()).toEqual([])
  })

  it('is persisted with the route', () => {
    s().replaceStops([1, 2, 3], ['fixed', 'dynamic', 'fixed'])
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    expect(saved.state.origins).toEqual(['fixed', 'dynamic', 'fixed'])
  })

  it('migrates saved state without origins to all fixed', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { stops: [5, 6, 7], freeScu: 20 }, version: 1 }),
    )
    await useAppStore.persist.rehydrate()
    expect(s().stops).toEqual([5, 6, 7])
    expect(origins()).toEqual(['fixed', 'fixed', 'fixed'])
    expect(s().freeScu).toBe(20)
  })

  it('repairs saved origins that do not fit the stops', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: { stops: [5, 6], origins: ['dynamic', 'bogus', 'dynamic'] },
        version: 1,
      }),
    )
    await useAppStore.persist.rehydrate()
    expect(origins()).toEqual(['dynamic', 'fixed'])
  })

  it('completing the route clears the origins too', () => {
    s().replaceStops([1, 2, 3], ['fixed', 'dynamic', 'fixed'])
    s().completeRoute()
    expect(s().stops).toEqual([])
    expect(origins()).toEqual([])
  })

  it('a changed origin alone does not reset the trip', () => {
    s().departStop()
    s().replaceStops([10, 11, 12], ['fixed', 'dynamic', 'fixed'])
    expect(s().trip.currentStop).toBe(1)
    expect(origins()).toEqual(['fixed', 'dynamic', 'fixed'])
  })
})
