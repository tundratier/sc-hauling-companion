import { describe, expect, it } from 'vitest'
import { calculate } from '../calc'
import {
  NOW,
  buyOffer,
  commodity,
  makeData,
  makeInput,
  sellOffer,
  terminal,
} from '../test-utils/calcFixtures'
import {
  INITIAL_TRIP,
  boughtAt,
  boughtKey,
  canComplete,
  canDepart,
  clampTrip,
  complete,
  departedSummary,
  depart,
  inProgress,
  isBought,
  isDeparted,
  isMoved,
  moveReminder,
  sellStopOf,
  unitSellOf,
  onBoard,
  remindersAt,
  sameRoute,
  snapshotOf,
  stopItems,
  summaryText,
  toggleBought,
  undo,
  type BoughtLine,
  type TripState,
} from './tripReducer'

// 4 stops: Scrap bought at 0 sells at 2 (and 3); Steel bought at 0 sells at 1; Waste bought at 1 sells at 3
const commodities = [
  commodity(1, { name: 'Scrap' }),
  commodity(2, { name: 'Steel' }),
  commodity(3, { name: 'Waste', isIllegal: true }),
]
const offers = [
  buyOffer(1, 1, 2954),
  sellOffer(1, 3, 3600),
  sellOffer(1, 4, 3500),
  buyOffer(2, 1, 100),
  sellOffer(2, 2, 150),
  buyOffer(3, 2, 10),
  sellOffer(3, 4, 30),
]
const terminals = [terminal(1), terminal(2), terminal(3), terminal(4)]
const result = calculate(
  makeInput({ stops: [1, 2, 3, 4], freeScu: 10 }),
  makeData({ commodities, terminals, offers }),
  NOW,
)
const haul = (name: string, from: number, to: number) => {
  const h = result.hauls.find((x) => x.commodity.name === name && x.from === from && x.to === to)
  if (!h) throw new Error(`no haul ${name} ${from}->${to}`)
  return h
}
const line = (name: string, from: number, to: number, rank = 0): BoughtLine =>
  snapshotOf(haul(name, from, to), rank)

const N = 4

describe('snapshotOf / keys', () => {
  it('copies what a reminder needs and builds the documented key', () => {
    const s = line('Scrap', 0, 2, 3)
    expect(s).toMatchObject({
      key: '0:1:2',
      buyStop: 0,
      sellStop: 2,
      commodityId: 1,
      commodityName: 'Scrap',
      unitBuy: 2954,
      unitSell: 3600,
      illegal: false,
      rank: 3,
    })
    expect(s.boxSizes.length).toBeGreaterThan(0)
    expect(boughtKey(0, 1, 2)).toBe('0:1:2')
    expect(line('Waste', 1, 3).illegal).toBe(true)
  })
})

describe('toggleBought', () => {
  it('adds a line at the current stop and removes it again', () => {
    const a = toggleBought(INITIAL_TRIP, line('Scrap', 0, 2))
    expect(a.bought.map((b) => b.key)).toEqual(['0:1:2'])
    expect(isBought(a, '0:1:2')).toBe(true)
    expect(toggleBought(a, line('Scrap', 0, 2)).bought).toEqual([])
  })

  it('allows several lines, including the same commodity to two sell stops, in marking order', () => {
    let s: TripState = INITIAL_TRIP
    s = toggleBought(s, line('Steel', 0, 1))
    s = toggleBought(s, line('Scrap', 0, 3))
    s = toggleBought(s, line('Scrap', 0, 2))
    expect(s.bought.map((b) => b.key)).toEqual(['0:2:1', '0:1:3', '0:1:2'])
  })

  it('ignores lines at other stops (later or already departed)', () => {
    expect(toggleBought(INITIAL_TRIP, line('Waste', 1, 3))).toBe(INITIAL_TRIP)
    const at1 = depart(INITIAL_TRIP, N)
    expect(toggleBought(at1, line('Scrap', 0, 2))).toBe(at1)
  })
})

describe('depart / undo', () => {
  it('moves to the next stop and marks the previous one as departed', () => {
    const s = depart(INITIAL_TRIP, N)
    expect(s.currentStop).toBe(1)
    expect(isDeparted(s, 0)).toBe(true)
    expect(isDeparted(s, 1)).toBe(false)
  })

  it('is offered at every stop but the last one, and never leaves the route', () => {
    expect(canDepart({ currentStop: 2, bought: [] }, N)).toBe(true)
    expect(canDepart({ currentStop: 3, bought: [] }, N)).toBe(false)
    expect(depart({ currentStop: 3, bought: [] }, N).currentStop).toBe(3)
    expect(canDepart(INITIAL_TRIP, 1)).toBe(false)
  })

  it('undoes the most recent departure and keeps the bought lines', () => {
    let s = toggleBought(INITIAL_TRIP, line('Scrap', 0, 2))
    s = depart(s, N)
    const back = undo(s)
    expect(back.currentStop).toBe(0)
    expect(back.bought).toEqual(s.bought)
    expect(undo(INITIAL_TRIP)).toBe(INITIAL_TRIP)
  })

  it('lets lines be toggled again after an undo', () => {
    const s = undo(depart(toggleBought(INITIAL_TRIP, line('Scrap', 0, 2)), N))
    expect(toggleBought(s, line('Scrap', 0, 2)).bought).toEqual([])
  })
})

describe('sell reminders and on-board list', () => {
  const trip = (): TripState => {
    let s = INITIAL_TRIP
    s = toggleBought(s, line('Steel', 0, 1))
    s = toggleBought(s, line('Scrap', 0, 2))
    s = depart(s, N)
    return s
  }

  it('shows nothing before the buy stop is departed', () => {
    const s = toggleBought(INITIAL_TRIP, line('Scrap', 0, 2))
    expect(remindersAt(s, 2)).toEqual([])
    expect(onBoard(s)).toEqual([])
  })

  it('turns lines bought at a departed stop into reminders at their sell stops', () => {
    const s = trip()
    expect(remindersAt(s, 1).map((b) => b.commodityName)).toEqual(['Steel'])
    expect(remindersAt(s, 2).map((b) => b.commodityName)).toEqual(['Scrap'])
    expect(remindersAt(s, 3)).toEqual([])
  })

  it('ends the reminders of a stop once it is departed', () => {
    const s = depart(trip(), N)
    expect(remindersAt(s, 1)).toEqual([])
    expect(remindersAt(s, 2).map((b) => b.commodityName)).toEqual(['Scrap'])
  })

  it('lists lines on board: bought at departed stops and not sold yet', () => {
    let s = trip()
    expect(onBoard(s).map((b) => `${b.commodityName}→${b.sellStop}`)).toEqual([
      'Steel→1',
      'Scrap→2',
    ])
    s = depart(s, N) // at stop 2: Steel sold at stop 1
    expect(onBoard(s).map((b) => b.commodityName)).toEqual(['Scrap'])
    s = depart(s, N) // at stop 3: Scrap sold at stop 2
    expect(onBoard(s)).toEqual([])
  })

  it('keeps the same commodity bought for two sell stops as two reminders', () => {
    let s = toggleBought(INITIAL_TRIP, line('Scrap', 0, 2))
    s = toggleBought(s, line('Scrap', 0, 3))
    s = depart(s, N)
    expect(remindersAt(s, 2)).toHaveLength(1)
    expect(remindersAt(s, 3)).toHaveLength(1)
  })

  it('reminder at a stop after an undo behaves like before the departure', () => {
    const s = undo(trip())
    expect(remindersAt(s, 1)).toEqual([])
  })
})

describe('departed summary', () => {
  it('lists what was bought and sold at a departed stop', () => {
    let s = toggleBought(INITIAL_TRIP, line('Steel', 0, 1))
    s = toggleBought(s, line('Scrap', 0, 2))
    s = depart(s, N)
    s = toggleBought(s, line('Waste', 1, 3))
    s = depart(s, N)
    expect(summaryText(s, 0)).toBe('Bought Steel, Scrap')
    expect(summaryText(s, 1)).toBe('Bought Waste · Sold Steel')
    expect(departedSummary(s, 1).sold.map((b) => b.commodityName)).toEqual(['Steel'])
    expect(boughtAt(s, 0).map((b) => b.commodityName)).toEqual(['Steel', 'Scrap'])
  })

  it('says so when nothing was bought', () => {
    const s = depart(INITIAL_TRIP, N)
    expect(summaryText(s, 0)).toBe('Nothing bought')
  })

  it('collapses duplicate commodity names (two sell stops)', () => {
    let s = toggleBought(INITIAL_TRIP, line('Scrap', 0, 2))
    s = toggleBought(s, line('Scrap', 0, 3))
    expect(summaryText(depart(s, N), 0)).toBe('Bought Scrap')
  })
})

describe('complete', () => {
  it('is available only at the last stop', () => {
    expect(canComplete(INITIAL_TRIP, N)).toBe(false)
    expect(canComplete({ currentStop: 2, bought: [] }, N)).toBe(false)
    expect(canComplete({ currentStop: 3, bought: [] }, N)).toBe(true)
    expect(canComplete(INITIAL_TRIP, 1)).toBe(false)
  })

  it('resets the trip', () => {
    expect(complete()).toEqual({ currentStop: 0, bought: [] })
  })
})

describe('route changes and clamping', () => {
  it('detects whether the route changed', () => {
    expect(sameRoute([1, 2, 3], [1, 2, 3])).toBe(true)
    expect(sameRoute([1, 2, 3], [1, 3, 2])).toBe(false)
    expect(sameRoute([1, 2], [1, 2, 3])).toBe(false)
  })

  it('knows when a trip is in progress', () => {
    expect(inProgress(INITIAL_TRIP)).toBe(false)
    expect(inProgress(depart(INITIAL_TRIP, N))).toBe(true)
    expect(inProgress(toggleBought(INITIAL_TRIP, line('Scrap', 0, 2)))).toBe(true)
  })

  it('clamps a persisted trip into a shorter route', () => {
    const s: TripState = { currentStop: 9, bought: [] }
    expect(clampTrip(s, 3).currentStop).toBe(2)
    expect(clampTrip(s, 0).currentStop).toBe(0)
    expect(clampTrip(INITIAL_TRIP, 3)).toBe(INITIAL_TRIP)
    expect(clampTrip({ currentStop: -2, bought: [] }, 3).currentStop).toBe(0)
  })
})

describe('stopItems (snapshots survive price refreshes)', () => {
  const options = result.hauls.filter((h) => h.from === 0).sort((a, b) => b.profit - a.profit)

  it('returns the ranked hauls unchanged when every bought line is still present', () => {
    const items = stopItems(options, [snapshotOf(options[0], 0)])
    expect(items.map((i) => i.kind)).toEqual(options.map(() => 'haul'))
  })

  it('keeps a bought line that disappeared from the results at its old position', () => {
    const gone = {
      ...line('Scrap', 0, 2, 1),
      key: '0:99:2',
      commodityId: 99,
      commodityName: 'Gone',
    }
    const items = stopItems(options, [gone])
    expect(items).toHaveLength(options.length + 1)
    expect(items[1]).toMatchObject({ kind: 'snapshot', key: '0:99:2' })
    expect(items[1].kind === 'snapshot' && items[1].line.commodityName).toBe('Gone')
  })

  it('clamps the old position into the list and orders several snapshots by rank', () => {
    const a = { ...line('Scrap', 0, 2, 50), key: 'a' }
    const b = { ...line('Scrap', 0, 2, 0), key: 'b' }
    const items = stopItems(options, [a, b])
    expect(items[0].key).toBe('b')
    expect(items.at(-1)?.key).toBe('a')
    expect(stopItems([], [b]).map((i) => i.key)).toEqual(['b'])
  })
})

describe('moveReminder ("Can\'t sell all?", §7.6)', () => {
  // Scrap bought at 0 (2,954), marked to sell at stop 2; we are at stop 1 with stop 0 departed
  const waiting = (): TripState => depart(toggleBought(INITIAL_TRIP, line('Scrap', 0, 2)), N)

  it('moves the reminder to a later stop, keeping the original sell stop and the key', () => {
    const moved = moveReminder(waiting(), '0:1:2', 3, 3500)
    const [b] = moved.bought
    expect(b).toMatchObject({ key: '0:1:2', sellStop: 2, sellAt: 3, unitSellAt: 3500 })
    expect(b.unitSell).toBe(3600) // the original snapshot stays
    expect(sellStopOf(b)).toBe(3)
    expect(unitSellOf(b)).toBe(3500)
    expect(isMoved(b)).toBe(true)
    expect(remindersAt(moved, 2)).toEqual([])
    expect(remindersAt(moved, 3).map((r) => r.key)).toEqual(['0:1:2'])
  })

  it('may sell earlier instead, at a stop that is not departed yet', () => {
    const moved = moveReminder(waiting(), '0:1:2', 1, 3100) // current stop is 1
    expect(remindersAt(moved, 1)).toHaveLength(1)
    expect(remindersAt(moved, 2)).toEqual([])
  })

  it('moves back to the original stop, which clears sellAt and unitSellAt', () => {
    const moved = moveReminder(waiting(), '0:1:2', 3, 3500)
    const back = moveReminder(moved, '0:1:2', 2, 3600)
    expect(back.bought[0]).not.toHaveProperty('sellAt')
    expect(back.bought[0]).not.toHaveProperty('unitSellAt')
    expect(isMoved(back.bought[0])).toBe(false)
    expect(back.bought[0]).toEqual(line('Scrap', 0, 2))
  })

  it('moves the whole line: one reminder, no quantity', () => {
    const moved = moveReminder(waiting(), '0:1:2', 3, 3500)
    expect(moved.bought).toHaveLength(1)
    expect(onBoard(moved).map(sellStopOf)).toEqual([3])
  })

  it.each([
    ['a departed stop', 0, 3500],
    ['the stop it is already at', 2, 3600],
    ['a stop that is not a whole number', 1.5, 1],
  ])('ignores a move to %s', (_name, stop, price) => {
    const state = waiting()
    expect(moveReminder(state, '0:1:2', stop, price)).toBe(state)
  })

  it('ignores unknown keys and lines that are not waiting yet', () => {
    const state = waiting()
    expect(moveReminder(state, 'nope', 3, 1)).toBe(state)
    // bought at the current stop: not a reminder yet
    const marking = toggleBought(INITIAL_TRIP, line('Scrap', 0, 2))
    expect(moveReminder(marking, '0:1:2', 3, 3500)).toBe(marking)
  })

  it('cannot move a reminder whose stop is already departed (it was sold there)', () => {
    let s = waiting()
    s = depart(s, N) // departs stop 1
    s = depart(s, N) // departs stop 2: the Scrap reminder there ends
    expect(moveReminder(s, '0:1:2', 3, 3500)).toBe(s)
  })

  it('a moved reminder survives departing its original stop and ends at the new one', () => {
    let s = moveReminder(waiting(), '0:1:2', 3, 3500)
    s = depart(s, N)
    s = depart(s, N) // stop 2 is departed; the reminder waits at 3
    expect(remindersAt(s, 3)).toHaveLength(1)
    expect(onBoard(s).map(sellStopOf)).toEqual([3])
    expect(departedSummary(s, 2).sold).toEqual([])
    expect(summaryText(s, 2)).toBe('Nothing bought')
  })

  it('counts the sale at the effective stop in the departed summary', () => {
    // moved from 2 to 1: selling at stop 1, so departing stop 1 reports "Sold Scrap"
    let s = moveReminder(waiting(), '0:1:2', 1, 3100)
    s = depart(s, N)
    expect(departedSummary(s, 1).sold.map((l) => l.commodityName)).toEqual(['Scrap'])
    expect(summaryText(s, 1)).toBe('Nothing bought · Sold Scrap')
    expect(summaryText(s, 2)).not.toContain('Sold')
    expect(onBoard(s)).toEqual([])
  })

  it('keeps the move when a departure is undone', () => {
    let s = moveReminder(waiting(), '0:1:2', 3, 3500)
    s = undo(s)
    s = depart(s, N)
    expect(sellStopOf(s.bought[0])).toBe(3)
  })

  it('loads lines persisted before the move existed unchanged', () => {
    const old: BoughtLine = JSON.parse(JSON.stringify(line('Scrap', 0, 2)))
    expect(old.sellAt).toBeUndefined()
    const state: TripState = { currentStop: 1, bought: [old] }
    expect(sellStopOf(old)).toBe(2)
    expect(unitSellOf(old)).toBe(3600)
    expect(isMoved(old)).toBe(false)
    expect(remindersAt(state, 2)).toHaveLength(1)
    expect(onBoard(state)).toHaveLength(1)
  })

  it('survives a JSON round trip (persisted with the trip)', () => {
    const moved = moveReminder(waiting(), '0:1:2', 3, 3500)
    expect(JSON.parse(JSON.stringify(moved))).toEqual(moved)
  })
})
