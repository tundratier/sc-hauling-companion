import { beforeEach, describe, expect, it } from 'vitest'
import { fixtureStatic } from '../test-utils/staticData'
import {
  MAX_STOPS,
  STORAGE_KEY,
  clampFreeScu,
  defaultMaxBox,
  normalizeBoxRange,
  useAppStore,
} from './useAppStore'

const { vehicles } = fixtureStatic().data
const vehicle = (id: number) => vehicles.find((v) => v.id === id)!

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState(useAppStore.getInitialState(), true)
})

describe('ship selection', () => {
  it('sets free SCU to the ship capacity and max box to its largest accepted size', () => {
    useAppStore.getState().selectVehicle(vehicle(100))
    expect(useAppStore.getState()).toMatchObject({
      vehicleId: 100,
      freeScu: 46,
      boxMin: 4,
      boxMax: 16,
    })
  })

  it('preselects 32 when the ship box sizes are unknown', () => {
    useAppStore.getState().selectVehicle(vehicle(104))
    expect(useAppStore.getState()).toMatchObject({ freeScu: 288, boxMin: 4, boxMax: 32 })
    expect(defaultMaxBox(vehicle(104))).toBe(32)
    expect(defaultMaxBox(null)).toBe(32)
  })

  it('clears the ship', () => {
    useAppStore.getState().selectVehicle(vehicle(100))
    useAppStore.getState().selectVehicle(null)
    expect(useAppStore.getState()).toMatchObject({ vehicleId: null, boxMin: 4, boxMax: 32 })
  })
})

describe('free SCU', () => {
  it('clamps to 1…ship SCU, or 1…100,000 without a ship', () => {
    expect(clampFreeScu(0, 46)).toBe(1)
    expect(clampFreeScu(500, 46)).toBe(46)
    expect(clampFreeScu(500)).toBe(500)
    expect(clampFreeScu(1_000_000)).toBe(100_000)
    expect(clampFreeScu(Number.NaN, 46)).toBe(1)
    expect(clampFreeScu(12.9, 46)).toBe(12)
  })

  it('setFreeScu stores the clamped value', () => {
    useAppStore.getState().setFreeScu(80, 46)
    expect(useAppStore.getState().freeScu).toBe(46)
  })
})

describe('box size and filters', () => {
  it('snaps the box range to standard sizes and orders the ends', () => {
    useAppStore.getState().setBoxRange(4, 16)
    expect(useAppStore.getState()).toMatchObject({ boxMin: 4, boxMax: 16 })
    useAppStore.getState().setBoxRange(7, 3)
    expect(useAppStore.getState()).toMatchObject({ boxMin: 2, boxMax: 8 })
    expect(normalizeBoxRange(100, 0)).toEqual({ boxMin: 1, boxMax: 32 })
  })

  it('has the documented defaults', () => {
    expect(useAppStore.getState()).toMatchObject({
      includeIllegal: true,
      includeVolatileQt: false,
      maxPriceAgeDays: null,
      showConceptShips: false,
      showUnavailableTerminals: false,
    })
  })
})

describe('route stops', () => {
  const add = (...ids: number[]) => ids.forEach((id) => useAppStore.getState().addStop(id))
  const stops = () => useAppStore.getState().stops

  it('adds stops (the same terminal may repeat) up to 10', () => {
    add(1, 2, 1)
    expect(stops()).toEqual([1, 2, 1])
    add(...Array.from({ length: 20 }, (_, i) => i + 10))
    expect(stops()).toHaveLength(MAX_STOPS)
  })

  it('removes by position', () => {
    add(1, 2, 1)
    useAppStore.getState().removeStop(0)
    expect(stops()).toEqual([2, 1])
  })

  it('moves a stop', () => {
    add(1, 2, 3, 4)
    useAppStore.getState().moveStop(0, 2)
    expect(stops()).toEqual([2, 3, 1, 4])
    useAppStore.getState().moveStop(3, 0)
    expect(stops()).toEqual([4, 2, 3, 1])
  })

  it('ignores invalid moves', () => {
    add(1, 2)
    useAppStore.getState().moveStop(0, 0)
    useAppStore.getState().moveStop(-1, 1)
    useAppStore.getState().moveStop(0, 5)
    useAppStore.getState().moveStop(5, 0)
    expect(stops()).toEqual([1, 2])
  })

  it('reverses and clears', () => {
    add(1, 2, 3)
    useAppStore.getState().reverseStops()
    expect(stops()).toEqual([3, 2, 1])
    useAppStore.getState().clearStops()
    expect(stops()).toEqual([])
  })
})

describe('persistence', () => {
  it('persists user input under shc:v1 (no actions, no API data)', () => {
    useAppStore.getState().selectVehicle(vehicle(100))
    useAppStore.getState().addStop(10)
    useAppStore.getState().setTab('route')
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(saved.version).toBe(1)
    expect(saved.state).toMatchObject({
      tab: 'route',
      vehicleId: 100,
      freeScu: 46,
      boxMin: 4,
      boxMax: 16,
      stops: [10],
    })
    expect(Object.values(saved.state).some((v) => typeof v === 'function')).toBe(false)
  })

  it('restores persisted state on rehydrate', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, state: { tab: 'trades', stops: [1, 2], freeScu: 12 } }),
    )
    await useAppStore.persist.rehydrate()
    expect(useAppStore.getState()).toMatchObject({ tab: 'trades', stops: [1, 2], freeScu: 12 })
  })
})
