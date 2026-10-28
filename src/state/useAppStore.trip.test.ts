import { beforeEach, describe, expect, it } from 'vitest'
import { STORAGE_KEY, useAppStore } from './useAppStore'
import { INITIAL_TRIP, type BoughtLine } from '../trip/tripReducer'

const line = (buyStop: number, sellStop: number, id = 1): BoughtLine => ({
  key: `${buyStop}:${id}:${sellStop}`,
  buyStop,
  sellStop,
  commodityId: id,
  commodityName: `C${id}`,
  unitBuy: 100,
  unitSell: 150,
  boxSizes: [4, 8],
  illegal: false,
  rank: 0,
})

const s = () => useAppStore.getState()

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useAppStore.setState({ stops: [10, 11, 12, 13] })
})

describe('trip actions', () => {
  it('starts at stop 0 with nothing bought', () => {
    expect(s().trip).toEqual(INITIAL_TRIP)
  })

  it('marks lines at the current stop, departs and undoes', () => {
    s().toggleBought(line(0, 2))
    s().toggleBought(line(1, 3, 2)) // not the current stop → ignored
    expect(s().trip.bought.map((b) => b.key)).toEqual(['0:1:2'])
    s().departStop()
    expect(s().trip.currentStop).toBe(1)
    s().undoDepart()
    expect(s().trip.currentStop).toBe(0)
    expect(s().trip.bought).toHaveLength(1)
  })

  it('never departs past the last stop', () => {
    for (let i = 0; i < 10; i++) s().departStop()
    expect(s().trip.currentStop).toBe(3)
  })

  it('completes the route: clears stops and trip, keeps settings, opens ROUTE', () => {
    useAppStore.setState({ tab: 'trades', vehicleId: 7, freeScu: 20, boxMin: 8, boxMax: 16 })
    s().departStop()
    s().toggleBought(line(1, 3))
    s().completeRoute()
    expect(s()).toMatchObject({
      stops: [],
      tab: 'route',
      trip: INITIAL_TRIP,
      vehicleId: 7,
      freeScu: 20,
      boxMin: 8,
      boxMax: 16,
    })
  })
})

describe('trip reset on route changes', () => {
  const progress = () => {
    s().departStop()
    s().toggleBought(line(1, 3))
    expect(s().trip.currentStop).toBe(1)
  }

  it.each([
    ['add', () => s().addStop(99)],
    ['remove', () => s().removeStop(0)],
    ['reorder', () => s().moveStop(0, 2)],
    ['reverse', () => s().reverseStops()],
    ['clear', () => s().clearStops()],
  ])('%s resets the trip', (_name, edit) => {
    progress()
    edit()
    expect(s().trip).toEqual(INITIAL_TRIP)
  })

  it('keeps progress when an edit changes nothing', () => {
    progress()
    s().moveStop(0, 0)
    s().moveStop(9, 1)
    expect(s().trip.currentStop).toBe(1)
  })

  it('keeps progress when other settings change', () => {
    progress()
    s().setFreeScu(10)
    s().setIncludeIllegal(false)
    expect(s().trip.currentStop).toBe(1)
  })

  it('does not reset when adding a stop is refused at the maximum', () => {
    useAppStore.setState({ stops: Array.from({ length: 10 }, (_, i) => i + 1) })
    s().departStop()
    s().addStop(99)
    expect(s().trip.currentStop).toBe(1)
  })
})

describe('trip persistence', () => {
  it('persists trip progress and restores it after a reload', async () => {
    s().toggleBought(line(0, 2))
    s().departStop()
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    expect(saved.state.trip.currentStop).toBe(1)
    expect(saved.state.trip.bought).toHaveLength(1)
    useAppStore.setState({ trip: INITIAL_TRIP })
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
    await useAppStore.persist.rehydrate()
    expect(s().trip.currentStop).toBe(1)
    expect(s().trip.bought[0].commodityName).toBe('C1')
  })
})
