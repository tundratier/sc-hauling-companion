import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '../state/useAppStore'
import { buyOffer, commodity, sellOffer } from '../test-utils/calcFixtures'
import { seedTrades, setPrices } from '../test-utils/tradesSeed'
import { INITIAL_TRIP } from '../trip/tripReducer'
import { RouteView } from './RouteView'
import { TradesView } from './TradesView'

// stop 1: Scrap (sells at 2 and 3) and Steel (sells at 3); stop 2: Waste (sells at 3, illegal)
const commodities = [
  commodity(1, { name: 'Scrap' }),
  commodity(2, { name: 'Steel' }),
  commodity(3, { name: 'Waste', isIllegal: true }),
]
const offers = [
  buyOffer(1, 1, 2954),
  sellOffer(1, 2, 3100),
  sellOffer(1, 3, 3600),
  buyOffer(2, 1, 1000),
  sellOffer(2, 3, 1200),
  buyOffer(3, 2, 10),
  sellOffer(3, 3, 30),
]

const section = (n: number) => screen.getByRole('region', { name: `Stop ${n}` })
const lines = (n: number) => within(section(n)).queryAllByRole('listitem')
const line = (n: number, name: string, sell?: number) => {
  const found = lines(n).find(
    (l) =>
      l.textContent?.includes(name) && (sell === undefined || l.textContent.includes(`#${sell}`)),
  )
  if (!found) throw new Error(`no line ${name} at stop ${n}`)
  return found
}
const toggle = (el: HTMLElement) => within(el).getAllByRole('button')[0]

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState(useAppStore.getInitialState(), true)
  seedTrades({ offers, commodities })
})

describe('marking lines as bought', () => {
  it('tapping a line at the current stop toggles a green highlight and a check mark', async () => {
    const user = userEvent.setup()
    render(<TradesView />)
    const scrap = line(1, 'Scrap', 3)
    expect(toggle(scrap)).toHaveAttribute('aria-pressed', 'false')
    expect(scrap).not.toHaveClass('option--bought')
    await user.click(toggle(scrap))
    expect(toggle(scrap)).toHaveAttribute('aria-pressed', 'true')
    expect(scrap).toHaveClass('option--bought')
    expect(scrap.querySelector('.option__check')).toHaveTextContent('✓')
    expect(useAppStore.getState().trip.bought.map((b) => b.key)).toEqual(['0:1:2'])
    await user.click(toggle(scrap))
    expect(scrap).not.toHaveClass('option--bought')
    expect(useAppStore.getState().trip.bought).toEqual([])
  })

  it('allows several lines, including the same commodity to two sell stops', async () => {
    const user = userEvent.setup()
    render(<TradesView />)
    await user.click(toggle(line(1, 'Scrap', 2)))
    await user.click(toggle(line(1, 'Scrap', 3)))
    await user.click(toggle(line(1, 'Steel')))
    expect(useAppStore.getState().trip.bought.map((b) => b.key)).toEqual([
      '0:1:1',
      '0:1:2',
      '0:2:2',
    ])
  })

  it('emphasizes the current stop and shows the progress in the summary', () => {
    render(<TradesView />)
    expect(section(1)).toHaveClass('stop-section--current')
    expect(section(2)).not.toHaveClass('stop-section--current')
    expect(screen.getByRole('region', { name: 'Summary' })).toHaveTextContent('AT STOP 1 OF 3')
  })

  it('always shows bought lines, even outside the top 5', async () => {
    const many = Array.from({ length: 8 }, (_, i) => commodity(i + 1, { name: `Item ${i + 1}` }))
    const manyOffers = many.flatMap((c) => [buyOffer(c.id, 1, 100), sellOffer(c.id, 2, 100 + c.id)])
    seedTrades({ offers: manyOffers, commodities: many, stops: [1, 2] })
    const user = userEvent.setup()
    render(<TradesView />)
    expect(lines(1)).toHaveLength(5)
    await user.click(within(section(1)).getByRole('button', { name: 'Show 3 more' }))
    await user.click(toggle(line(1, 'Item 1')))
    await user.click(within(section(1)).getByRole('button', { name: 'Show fewer' }))
    expect(lines(1)).toHaveLength(6) // top 5 + the bought Item 1
    expect(line(1, 'Item 1')).toHaveClass('option--bought')
    expect(within(section(1)).getByRole('button', { name: 'Show 2 more' })).toBeInTheDocument()
  })
})

describe('depart and undo', () => {
  it('offers DEPART at the current stop but not at the last stop', () => {
    render(<TradesView />)
    expect(within(section(1)).getByRole('button', { name: 'Depart →' })).toBeInTheDocument()
    expect(within(section(2)).queryByRole('button', { name: 'Depart →' })).not.toBeInTheDocument()
    expect(within(section(3)).queryByRole('button', { name: 'Depart →' })).not.toBeInTheDocument()
  })

  it('collapses the departed stop with a summary and moves the focus to the next stop', async () => {
    const user = userEvent.setup()
    render(<TradesView />)
    await user.click(toggle(line(1, 'Scrap', 3)))
    await user.click(toggle(line(1, 'Steel')))
    await user.click(within(section(1)).getByRole('button', { name: 'Depart →' }))
    expect(section(1)).toHaveClass('stop-section--departed')
    expect(section(1)).toHaveTextContent('DEPARTED')
    expect(section(1)).toHaveTextContent('Bought Scrap, Steel')
    expect(within(section(1)).queryByRole('list')).not.toBeInTheDocument()
    expect(section(2)).toHaveClass('stop-section--current')
    expect(screen.getByRole('region', { name: 'Summary' })).toHaveTextContent('AT STOP 2 OF 3')
    // the next stop is markable now
    expect(toggle(line(2, 'Waste'))).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows a sell reminder at each sell stop, dimmed until the player gets there', async () => {
    const user = userEvent.setup()
    render(<TradesView />)
    await user.click(toggle(line(1, 'Scrap', 3)))
    await user.click(within(section(1)).getByRole('button', { name: 'Depart →' }))
    const reminder = within(section(3)).getByRole('heading', { name: 'Sell here' }).parentElement
    expect(reminder).toHaveClass('reminders--upcoming')
    expect(reminder).toHaveTextContent('Scrap')
    expect(reminder).toHaveTextContent('bought #1 ARC-L1 @ 2,954 → sell @ 3,600 /SCU')
    expect(within(section(2)).queryByText('Sell here')).not.toBeInTheDocument()
  })

  it('shows reminders undimmed at the current stop, with the ILLEGAL badge', async () => {
    const user = userEvent.setup()
    render(<TradesView />)
    await user.click(toggle(line(1, 'Scrap', 2)))
    await user.click(within(section(1)).getByRole('button', { name: 'Depart →' }))
    await user.click(toggle(line(2, 'Waste')))
    await user.click(within(section(2)).getByRole('button', { name: 'Depart →' }))
    // now at stop 3: the Scrap reminder at stop 2 has ended, Waste reminds at stop 3
    expect(within(section(2)).queryByText('Sell here')).not.toBeInTheDocument()
    const reminder = within(section(3)).getByRole('heading', { name: 'Sell here' }).parentElement
    expect(reminder).not.toHaveClass('reminders--upcoming')
    expect(reminder).toHaveTextContent('Waste')
    expect(reminder).toHaveTextContent('ILLEGAL')
    expect(section(2)).toHaveTextContent('Bought Waste · Sold Scrap')
  })

  it('lists what is on board in the summary', async () => {
    const user = userEvent.setup()
    render(<TradesView />)
    await user.click(toggle(line(1, 'Scrap', 3)))
    await user.click(toggle(line(1, 'Steel')))
    await user.click(within(section(1)).getByRole('button', { name: 'Depart →' }))
    expect(screen.getByRole('region', { name: 'Summary' })).toHaveTextContent(
      'On board: Scrap → #3, Steel → #3',
    )
  })

  it('offers UNDO on the most recent departure only and restores the previous state', async () => {
    const user = userEvent.setup()
    render(<TradesView />)
    await user.click(toggle(line(1, 'Scrap', 3)))
    await user.click(within(section(1)).getByRole('button', { name: 'Depart →' }))
    await user.click(within(section(2)).getByRole('button', { name: 'Depart →' }))
    expect(within(section(1)).queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    await user.click(within(section(2)).getByRole('button', { name: 'Undo' }))
    expect(useAppStore.getState().trip.currentStop).toBe(1)
    expect(section(2)).toHaveClass('stop-section--current')
    await user.click(within(section(1)).getByRole('button', { name: 'Undo' }))
    expect(useAppStore.getState().trip.currentStop).toBe(0)
    expect(useAppStore.getState().trip.bought).toHaveLength(1)
    expect(line(1, 'Scrap', 3)).toHaveClass('option--bought')
  })

  it('expands a departed stop read-only (no toggles, no depart)', async () => {
    const user = userEvent.setup()
    render(<TradesView />)
    await user.click(toggle(line(1, 'Scrap', 3)))
    await user.click(within(section(1)).getByRole('button', { name: 'Depart →' }))
    await user.click(within(section(1)).getByRole('button', { name: /ARC-L1 Wide Forest Station/ }))
    expect(line(1, 'Scrap', 3)).toHaveClass('option--bought')
    expect(line(1, 'Scrap', 3).querySelector('[aria-pressed]')).toBeNull()
    expect(within(section(1)).queryByRole('button', { name: 'Depart →' })).not.toBeInTheDocument()
  })
})

describe('complete route', () => {
  it('appears only at the last stop and clears the stops and opens ROUTE', async () => {
    const user = userEvent.setup()
    render(<TradesView />)
    expect(screen.queryByRole('button', { name: 'Complete route ✓' })).not.toBeInTheDocument()
    await user.click(within(section(1)).getByRole('button', { name: 'Depart →' }))
    await user.click(within(section(2)).getByRole('button', { name: 'Depart →' }))
    await user.click(screen.getByRole('button', { name: 'Complete route ✓' }))
    expect(useAppStore.getState()).toMatchObject({
      stops: [],
      tab: 'route',
      trip: INITIAL_TRIP,
      vehicleId: 100,
      freeScu: 46,
      boxMin: 1,
      boxMax: 16,
    })
  })
})

describe('price refreshes and persistence', () => {
  it('keeps a bought line from its snapshot when it disappears from the results', async () => {
    const user = userEvent.setup()
    render(<TradesView />)
    await user.click(toggle(line(1, 'Steel')))
    act(() => setPrices(offers.filter((o) => o.commodityId !== 2)))
    const steel = line(1, 'Steel')
    expect(steel).toHaveClass('option--bought')
    expect(steel).toHaveTextContent('UPDATED PRICES')
    expect(steel).toHaveTextContent('BUY 1,000 → SELL 1,200 /SCU')
    expect(steel).toHaveTextContent('#3 CBD Lorville')
    // can still be unmarked at the current stop
    await user.click(toggle(steel))
    expect(useAppStore.getState().trip.bought).toEqual([])
  })

  it('keeps showing reminders after the buy line disappeared from the results', async () => {
    const user = userEvent.setup()
    render(<TradesView />)
    await user.click(toggle(line(1, 'Steel')))
    await user.click(within(section(1)).getByRole('button', { name: 'Depart →' }))
    act(() => setPrices([]))
    expect(
      within(section(3)).getByRole('heading', { name: 'Sell here' }).parentElement,
    ).toHaveTextContent('Steel')
  })

  it('restores the trip after a reload (persisted state)', async () => {
    const user = userEvent.setup()
    const first = render(<TradesView />)
    await user.click(toggle(line(1, 'Scrap', 3)))
    await user.click(within(section(1)).getByRole('button', { name: 'Depart →' }))
    first.unmount()
    const saved = localStorage.getItem('shc:v1') ?? ''
    useAppStore.setState({ trip: INITIAL_TRIP })
    localStorage.setItem('shc:v1', saved)
    await useAppStore.persist.rehydrate()
    render(<TradesView />)
    expect(section(2)).toHaveClass('stop-section--current')
    expect(within(section(3)).getByRole('heading', { name: 'Sell here' })).toBeInTheDocument()
  })

  it('shows the trip progress warning on the ROUTE view', async () => {
    const user = userEvent.setup()
    const first = render(<TradesView />)
    await user.click(within(section(1)).getByRole('button', { name: 'Depart →' }))
    first.unmount()
    render(<RouteView />)
    expect(screen.getByRole('note')).toHaveTextContent(
      'Editing the route resets trip progress (at stop 2 of 3)',
    )
  })
})

describe('line details without a chevron (spec rev 5)', () => {
  it('has no details/chevron button on any line', () => {
    render(<TradesView />)
    for (const n of [1, 2, 3]) {
      for (const l of lines(n)) {
        expect(within(l).getAllByRole('button')).toHaveLength(1)
        expect(l.textContent).not.toMatch(/[⌄⌃]/)
      }
    }
  })

  it('shows the details of a bought line at the current stop and collapses them when unmarked', async () => {
    const user = userEvent.setup()
    render(<TradesView />)
    const scrap = line(1, 'Scrap', 3)
    expect(within(scrap).queryByText('Margin / SCU')).not.toBeInTheDocument()
    await user.click(toggle(scrap))
    expect(within(scrap).getByText('Margin / SCU')).toBeInTheDocument()
    expect(within(scrap).getByText(/boxes$/)).toBeInTheDocument()
    await user.click(toggle(scrap))
    expect(within(scrap).queryByText('Margin / SCU')).not.toBeInTheDocument()
  })

  it('expands lines at later stops on tap (aria-expanded) and collapses them again', async () => {
    const user = userEvent.setup()
    render(<TradesView />)
    const waste = line(2, 'Waste')
    const button = within(waste).getByRole('button')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).not.toHaveAttribute('aria-pressed')
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(within(waste).getByText('Margin / SCU')).toBeInTheDocument()
    expect(useAppStore.getState().trip.bought).toEqual([])
    await user.click(button)
    expect(within(waste).queryByText('Margin / SCU')).not.toBeInTheDocument()
  })

  it('expands lines of a departed stop on tap, read-only', async () => {
    const user = userEvent.setup()
    render(<TradesView />)
    await user.click(toggle(line(1, 'Scrap', 3)))
    await user.click(within(section(1)).getByRole('button', { name: 'Depart →' }))
    await user.click(within(section(1)).getByRole('button', { name: /ARC-L1 Wide Forest Station/ }))
    const steel = line(1, 'Steel')
    await user.click(within(steel).getByRole('button'))
    expect(within(steel).getByText('Margin / SCU')).toBeInTheDocument()
    expect(useAppStore.getState().trip.bought).toHaveLength(1)
  })
})
