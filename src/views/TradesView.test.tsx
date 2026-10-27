import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PriceOffer, Vehicle } from '../domain/types'
import { UexError } from '../api/uexClient'
import { useAppStore } from '../state/useAppStore'
import { useDataStore } from '../state/useDataStore'
import { buyOffer, commodity, sellOffer, terminal } from '../test-utils/calcFixtures'
import { droppedLines, TradesView } from './TradesView'

const nowSec = () => Math.floor(Date.now() / 1000)
const ago = (days: number) => nowSec() - Math.round(days * 86400)

const vehicle: Vehicle = {
  id: 100,
  name: 'Cutlass Black',
  nameFull: 'Drake Cutlass Black',
  scu: 46,
  containerSizes: [1, 2, 4, 8, 16],
  isConcept: false,
  isGroundVehicle: false,
  isSpaceship: true,
  padType: 'M',
}

interface Seed {
  offers: PriceOffer[]
  commodities?: ReturnType<typeof commodity>[]
  stops?: number[]
  ship?: boolean
  prices?: boolean
}

function seed({ offers, commodities, stops = [1, 2, 3], ship = true, prices = true }: Seed) {
  useAppStore.setState({
    stops,
    vehicleId: ship ? 100 : null,
    freeScu: 46,
    maxBox: 16,
    tab: 'trades',
  })
  useDataStore.setState({
    staticData: {
      data: {
        commodities: commodities ?? [commodity(1, { name: 'Laranite' })],
        terminals: [
          terminal(1, {
            displayname: 'ARC-L1 Wide Forest Station',
            nickname: 'ARC-L1',
            name: 'Admin - ARC-L1',
          }),
          terminal(2, { displayname: 'Area18', nickname: 'TDD Area 18', name: 'TDD - Area 18' }),
          terminal(3, {
            displayname: 'Lorville',
            nickname: 'CBD Lorville',
            name: 'CBD - Lorville',
          }),
        ],
        vehicles: [vehicle],
        gameVersions: { live: '4.10.2', ptu: '4.10.3' },
      },
      fetchedAt: Date.now(),
      gameVersion: '4.10.2',
      stale: false,
      error: null,
    },
    staticStatus: 'ready',
    prices: prices
      ? {
          data: { offers },
          fetchedAt: Date.now() - 12 * 60_000,
          gameVersion: '4.10.2',
          stale: false,
          error: null,
        }
      : null,
    pricesStatus: prices ? 'ready' : 'idle',
    pricesError: null,
    offlineError: null,
    refreshing: false,
  })
}

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState(useAppStore.getInitialState(), true)
})

const laranite = [
  buyOffer(1, 1, 2810, { dateModified: ago(0.2) }),
  sellOffer(1, 3, 3315, { dateModified: ago(0.1) }),
]

describe('TradesView states', () => {
  it('asks for at least two stops and links to ROUTE', async () => {
    seed({ offers: laranite, stops: [1] })
    const user = userEvent.setup()
    render(<TradesView />)
    expect(screen.getByText(/Add at least two stops/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Go to ROUTE' }))
    expect(useAppStore.getState().tab).toBe('route')
  })

  it('shows a loading state while prices are fetched, and a blocking error with Retry', () => {
    seed({ offers: [], prices: false })
    useDataStore.setState({ pricesStatus: 'loading' })
    const { unmount } = render(<TradesView />)
    expect(screen.getByText('Loading prices…')).toBeInTheDocument()
    unmount()
    useDataStore.setState({
      pricesStatus: 'error',
      pricesError: new UexError('network', 'offline'),
    })
    render(<TradesView />)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load prices: offline')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('shows the summary: route, free SCU, ship and price age', () => {
    seed({ offers: laranite })
    render(<TradesView />)
    const summary = screen.getByRole('region', { name: 'Summary' })
    expect(summary).toHaveTextContent('ARC-L1 → TDD Area 18 → CBD Lorville')
    expect(summary).toHaveTextContent('Free cargo 46 SCU · Drake Cutlass Black')
    expect(summary).toHaveTextContent(/Prices updated \d\d:\d\d · 12m ago/)
  })

  it('says "no ship selected" without a ship', () => {
    seed({ offers: laranite, ship: false })
    render(<TradesView />)
    expect(screen.getByText(/no ship selected/)).toBeInTheDocument()
  })

  it('reports no profitable trades and counts dropped trades by reason', () => {
    seed({
      offers: [
        buyOffer(1, 1, 100, { containerSizes: [24, 32] }),
        sellOffer(1, 3, 200),
        buyOffer(2, 1, 100),
        sellOffer(2, 3, 150),
        buyOffer(3, 1, 100),
        sellOffer(3, 3, 150),
        buyOffer(4, 1, 100),
        sellOffer(4, 3, 150, { dateModified: ago(30) }),
      ],
      commodities: [
        commodity(1),
        commodity(2, { isIllegal: true }),
        commodity(3, { isVolatileQt: true }),
        commodity(4),
      ],
    })
    useAppStore.setState({ includeIllegal: false, maxPriceAgeDays: 7 })
    render(<TradesView />)
    expect(screen.getByText('No profitable trades along this route.')).toBeInTheDocument()
    const dropped = screen.getByRole('list', { name: 'Trades not shown' })
    expect(dropped).toHaveTextContent('1 trade need bigger boxes than your ship takes')
    expect(dropped).toHaveTextContent('1 hidden by the illegal-commodities filter')
    expect(dropped).toHaveTextContent('1 hidden by the quantum-volatile filter')
    expect(dropped).toHaveTextContent('1 hidden by the price-age filter')
  })

  it('keeps the dropped counts visible next to results', () => {
    seed({
      offers: [...laranite, buyOffer(2, 1, 100, { containerSizes: [32] }), sellOffer(2, 3, 200)],
      commodities: [commodity(1, { name: 'Laranite' }), commodity(2)],
    })
    render(<TradesView />)
    expect(screen.getByRole('list', { name: 'Trades not shown' })).toHaveTextContent(
      '1 trade need bigger boxes',
    )
    expect(screen.getByText('Plans')).toBeInTheDocument()
  })
})

describe('plans', () => {
  // A→C (skip) margin 100, A→B + B→C margins 40 + 80
  const offers = [
    buyOffer(1, 1, 1000, { dateModified: ago(9) }),
    sellOffer(1, 3, 1100),
    buyOffer(2, 1, 1000, { statusBuy: 1, scuBuy: 0, scuBuyAvg: 0, dateModified: ago(9) }),
    sellOffer(2, 2, 1040),
    buyOffer(3, 2, 1000),
    sellOffer(3, 3, 1080, { statusSell: 6 }),
  ]
  const commodities = [
    commodity(1, { name: 'Skipium' }),
    commodity(2, { name: 'Stockless', isIllegal: true }),
    commodity(3, { name: 'Demandite', isVolatileTime: true }),
  ]

  it('lists MAX, #2, … chips with a warning count and selects a plan', async () => {
    seed({ offers, commodities })
    const user = userEvent.setup()
    render(<TradesView />)
    const chips = within(screen.getByRole('tablist', { name: 'Plans' })).getAllByRole('tab')
    expect(chips.map((c) => c.textContent)).toEqual(['MAX ⚠2', '#2', '#3 ⚠1', '#4 ⚠1'])
    expect(chips[0]).toHaveAttribute('aria-selected', 'true')
    // MAX = Stockless A→B (1,840) + Demandite B→C (3,680)... compared with Skipium A→C
    const plan = screen.getByTestId('plan')
    expect(within(plan).getByText('Profit').nextElementSibling).toHaveTextContent('5,520')
    await user.click(chips[1])
    expect(chips[1]).toHaveAttribute('aria-selected', 'true')
    expect(
      within(screen.getByTestId('plan')).getByText('Profit').nextElementSibling,
    ).toHaveTextContent('4,600')
  })

  it('shows KPIs: profit, ROI, investment, capital required and peak SCU / C', () => {
    seed({ offers, commodities })
    render(<TradesView />)
    const plan = screen.getByTestId('plan')
    const kpi = (label: string) => within(plan).getByText(label).nextElementSibling!.textContent
    expect(kpi('Profit')).toContain('5,520')
    expect(kpi('ROI')).toBe('6.0%')
    expect(kpi('Investment')).toBe('92,000')
    expect(kpi('Capital required')).toBe('46,000')
    expect(kpi('Peak SCU')).toBe('46 / 46')
  })

  it('renders the execution timeline with BUY / SELL lines and boxes', () => {
    seed({ offers, commodities })
    render(<TradesView />)
    const timeline = screen.getByRole('list', { name: 'Execution timeline' })
    const stops = within(timeline).getAllByRole('listitem')
    expect(stops).toHaveLength(3)
    expect(stops[0]).toHaveTextContent('ARC-L1 Wide Forest Station')
    expect(stops[0]).toHaveTextContent('BUY')
    expect(stops[0]).toHaveTextContent('46 SCU Stockless')
    expect(stops[0]).toHaveTextContent('@ 1,000')
    expect(stops[0]).toHaveTextContent('= 46,000')
    expect(stops[0]).toHaveTextContent('boxes 2×16 · 1×8 · 1×4 · 1×2')
    expect(stops[1]).toHaveTextContent('SELL')
    expect(stops[1]).toHaveTextContent('+1,840')
    expect(stops[1]).toHaveTextContent('BUY')
    expect(stops[2]).toHaveTextContent('+3,680')
  })

  it('collapses pass-through stops with the SCU on board', () => {
    seed({
      offers: [buyOffer(1, 1, 1000), sellOffer(1, 3, 1100)],
      commodities: [commodity(1, { name: 'Skipium' })],
    })
    render(<TradesView />)
    const stops = within(screen.getByRole('list', { name: 'Execution timeline' })).getAllByRole(
      'listitem',
    )
    expect(stops[1]).toHaveTextContent('Area18')
    expect(stops[1]).toHaveTextContent('pass through · 46 SCU on board')
    expect(stops[1]).not.toHaveTextContent('BUY')
  })

  it('badges hauls: ILLEGAL, SKIPS, STALE, VOLATILE', () => {
    seed({ offers, commodities })
    render(<TradesView />)
    const hauls = screen.getAllByRole('article')
    const byName = (name: string) => hauls.find((h) => h.textContent?.includes(name))!
    expect(byName('Skipium')).toHaveTextContent('SKIPS 1')
    expect(byName('Skipium')).toHaveTextContent('STALE 9d')
    expect(byName('Skipium')).toHaveTextContent('LEGAL')
    expect(byName('Stockless')).toHaveTextContent('ILLEGAL')
    expect(byName('Demandite')).toHaveTextContent('VOLATILE')
  })

  it('explains an inventory warning with the reported values when tapped', async () => {
    seed({ offers, commodities })
    const user = userEvent.setup()
    render(<TradesView />)
    const plan = screen.getByTestId('plan')
    await user.click(within(plan).getByRole('button', { name: 'NO STOCK?' }))
    expect(within(plan).getByRole('note')).toHaveTextContent(
      'Reported 9 d ago at the buy stop: stock Out of Stock (0–14 %), 0 SCU. Inventory may have refilled since.',
    )
    await user.click(within(plan).getByRole('button', { name: 'NO STOCK?' }))
    expect(within(plan).queryByRole('note')).not.toBeInTheDocument()
    await user.click(within(plan).getByRole('button', { name: 'LOW DEMAND?' }))
    expect(within(plan).getByRole('note')).toHaveTextContent('demand Very High (72–85 %)')
  })
})

describe('single hauls', () => {
  it('shows every field of a haul (criterion 10) including a skip option (criterion 6)', () => {
    seed({
      offers: [
        buyOffer(1, 1, 2810, { dateModified: ago(0.4), statusBuy: 3, scuBuy: 0, scuBuyAvg: 54 }),
        sellOffer(1, 3, 3315, {
          dateModified: ago(2),
          statusSell: 5,
          scuSell: 14,
          scuSellStock: 2,
        }),
      ],
    })
    render(<TradesView />)
    const haul = screen.getByRole('article')
    expect(haul).toHaveTextContent('Laranite')
    expect(haul).toHaveTextContent('LEGAL')
    expect(haul).toHaveTextContent('SKIPS 1')
    expect(haul).toHaveTextContent('1 ARC-L1 → 3 CBD Lorville')
    expect(haul).toHaveTextContent('Buy / SCU2,810')
    expect(haul).toHaveTextContent('Sell / SCU3,315')
    expect(haul).toHaveTextContent('Margin / SCU505')
    expect(haul).toHaveTextContent('Quantity46 of 46 SCU')
    expect(haul).toHaveTextContent('□ 1·2·4·8·16 — 2×16 · 1×8 · 1×4 · 1×2')
    expect(haul).toHaveTextContent('Investment129,260')
    expect(haul).toHaveTextContent('Profit23,230')
    expect(haul).toHaveTextContent('ROI18.0%')
    expect(haul).toHaveTextContent('buy 9h · sell 2d')
    expect(haul).toHaveTextContent('Reported — buy: LO · 54 SCU · sell: HI · 14 SCU · stock 2')
  })

  it('keeps a NO STOCK? haul at full quantity (criterion 13)', () => {
    seed({
      offers: [
        buyOffer(1, 1, 1000, { statusBuy: 1, scuBuy: 0, scuBuyAvg: 0 }),
        sellOffer(1, 2, 1100),
      ],
      stops: [1, 2],
    })
    render(<TradesView />)
    const haul = screen.getByRole('article')
    expect(haul).toHaveTextContent('Quantity46 of 46 SCU')
    expect(within(haul).getByRole('button', { name: 'NO STOCK?' })).toBeInTheDocument()
  })

  it('sorts by profit, ROI, margin and investment', async () => {
    seed({
      offers: [
        buyOffer(1, 1, 100),
        sellOffer(1, 2, 130), // margin 30, roi 30 %, investment 4,600, profit 1,380
        buyOffer(2, 1, 1000),
        sellOffer(2, 2, 1100), // margin 100, roi 10 %, investment 46,000, profit 4,600
        buyOffer(3, 1, 10),
        sellOffer(3, 2, 20), // margin 10, roi 100 %, investment 460, profit 460
      ],
      commodities: [
        commodity(1, { name: 'Mid' }),
        commodity(2, { name: 'Big' }),
        commodity(3, { name: 'Cheap' }),
      ],
      stops: [1, 2],
    })
    const user = userEvent.setup()
    render(<TradesView />)
    const order = () => screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)
    expect(order()).toEqual(['Big', 'Mid', 'Cheap'])
    await user.selectOptions(screen.getByLabelText('Sort by'), 'ROI')
    expect(order()).toEqual(['Cheap', 'Mid', 'Big'])
    await user.selectOptions(screen.getByLabelText('Sort by'), 'Margin / SCU')
    expect(order()).toEqual(['Big', 'Mid', 'Cheap'])
    await user.selectOptions(screen.getByLabelText('Sort by'), 'Investment')
    expect(order()).toEqual(['Big', 'Mid', 'Cheap'])
  })

  it('paginates after 30 items with "Show more"', async () => {
    const commodities = Array.from({ length: 35 }, (_, i) =>
      commodity(i + 1, { name: `Item ${i + 1}` }),
    )
    const offers = commodities.flatMap((c) => [
      buyOffer(c.id, 1, 100),
      sellOffer(c.id, 2, 100 + c.id),
    ])
    seed({ offers, commodities, stops: [1, 2] })
    const user = userEvent.setup()
    render(<TradesView />)
    expect(screen.getAllByRole('article')).toHaveLength(30)
    expect(screen.getByText('Single hauls').parentElement).toHaveTextContent('35')
    await user.click(screen.getByRole('button', { name: 'Show more (5 left)' }))
    expect(screen.getAllByRole('article')).toHaveLength(35)
    expect(screen.queryByRole('button', { name: /Show more/ })).not.toBeInTheDocument()
  })

  it('never shows raw commodities (criterion 5)', () => {
    seed({
      offers: [buyOffer(1, 1, 100), sellOffer(1, 2, 200)],
      commodities: [commodity(1, { name: 'Raw Ore', isRaw: true })],
      stops: [1, 2],
    })
    render(<TradesView />)
    expect(screen.queryByText('Raw Ore')).not.toBeInTheDocument()
    expect(screen.getByText('No profitable trades along this route.')).toBeInTheDocument()
  })

  it('recomputes immediately when inputs change (criterion 4)', () => {
    seed({
      offers: [buyOffer(1, 1, 100), sellOffer(1, 2, 200)],
      stops: [1, 2],
    })
    const { unmount } = render(<TradesView />)
    expect(screen.getByRole('article')).toHaveTextContent('Quantity46 of 46 SCU')
    unmount()
    useAppStore.setState({ freeScu: 10 })
    render(<TradesView />)
    expect(screen.getByRole('article')).toHaveTextContent('Quantity10 of 10 SCU')
  })
})

describe('droppedLines', () => {
  it('pluralizes and skips zero counts', () => {
    expect(droppedLines({ boxSize: 0, illegal: 0, volatileQt: 0, priceAge: 0 })).toEqual([])
    expect(droppedLines({ boxSize: 2, illegal: 0, volatileQt: 0, priceAge: 3 })).toEqual([
      '2 trades need bigger boxes than your ship takes',
      '3 hidden by the price-age filter',
    ])
  })
})
