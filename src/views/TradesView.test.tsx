import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { UexError } from '../api/uexClient'
import type { PriceOffer, Vehicle } from '../domain/types'
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
  boxMin?: number
}

function seed({
  offers,
  commodities,
  stops = [1, 2, 3],
  ship = true,
  prices = true,
  boxMin = 1,
}: Seed) {
  useAppStore.setState({
    stops,
    vehicleId: ship ? 100 : null,
    freeScu: 46,
    boxMin,
    boxMax: 16,
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

const section = (n: number) => screen.getByRole('region', { name: `Stop ${n}` })
const lines = (n: number) => within(section(n)).queryAllByRole('listitem')
const profits = (n: number) => lines(n).map((l) => l.querySelector('.option__profit')?.textContent)

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

  it('shows the summary: route, free SCU, ship, box range and price age', () => {
    seed({ offers: laranite, boxMin: 4 })
    render(<TradesView />)
    const summary = screen.getByRole('region', { name: 'Summary' })
    expect(summary).toHaveTextContent('ARC-L1 → TDD Area 18 → CBD Lorville')
    expect(summary).toHaveTextContent('Free cargo 46 SCU · Drake Cutlass Black · boxes 4–16 SCU')
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
        buyOffer(5, 1, 100, { containerSizes: [1, 2] }),
        sellOffer(5, 3, 150),
      ],
      commodities: [
        commodity(1),
        commodity(2, { isIllegal: true }),
        commodity(3, { isVolatileQt: true }),
        commodity(4),
        commodity(5),
      ],
      boxMin: 4,
    })
    useAppStore.setState({ includeIllegal: false, maxPriceAgeDays: 7 })
    render(<TradesView />)
    expect(screen.getByText('No profitable trades along this route.')).toBeInTheDocument()
    const dropped = screen.getByRole('list', { name: 'Trades not shown' })
    expect(dropped).toHaveTextContent('1 trade need bigger boxes than your ship takes')
    expect(dropped).toHaveTextContent('1 trade only comes in boxes smaller than your minimum')
    expect(dropped).toHaveTextContent('1 hidden by the illegal-commodities filter')
    expect(dropped).toHaveTextContent('1 hidden by the quantum-volatile filter')
    expect(dropped).toHaveTextContent('1 hidden by the price-age filter')
  })

  it('never shows raw commodities', () => {
    seed({
      offers: [buyOffer(1, 1, 100), sellOffer(1, 2, 200)],
      commodities: [commodity(1, { name: 'Raw Ore', isRaw: true })],
      stops: [1, 2],
    })
    render(<TradesView />)
    expect(screen.queryByText('Raw Ore')).not.toBeInTheDocument()
    expect(screen.getByText('No profitable trades along this route.')).toBeInTheDocument()
  })
})

describe('stop sections (criterion 6)', () => {
  // stop 1 buys Alpha (sells at stops 2 and 3) and Beta (sells at stop 3); stop 2 buys Gamma
  const commodities = [
    commodity(1, { name: 'Alpha' }),
    commodity(2, { name: 'Beta', isIllegal: true }),
    commodity(3, { name: 'Gamma' }),
  ]
  const offers = [
    buyOffer(1, 1, 100, { dateModified: ago(9) }),
    sellOffer(1, 2, 130),
    sellOffer(1, 3, 150),
    buyOffer(2, 1, 1000, { statusBuy: 1, scuBuy: 0, scuBuyAvg: 0 }),
    sellOffer(2, 3, 1060, { statusSell: 6 }),
    buyOffer(3, 2, 10),
    sellOffer(3, 3, 25),
  ]

  it('renders one section per stop, in route order, with number and terminal name', () => {
    seed({ offers, commodities })
    render(<TradesView />)
    const sections = screen.getAllByRole('region').filter((r) => /^Stop \d/.test(r.ariaLabel ?? ''))
    expect(sections).toHaveLength(3)
    expect(sections[0]).toHaveTextContent('1ARC-L1 Wide Forest Station')
    expect(sections[1]).toHaveTextContent('2Area18')
    expect(sections[2]).toHaveTextContent('3Lorville')
  })

  it('lists buy options ranked by profit; each line names its sell stop; skips are badged', () => {
    seed({ offers, commodities })
    render(<TradesView />)
    const first = lines(1)
    expect(first).toHaveLength(3)
    expect(first[0]).toHaveTextContent('Beta')
    expect(first[0]).toHaveTextContent('→ #3 CBD Lorville')
    expect(first[1]).toHaveTextContent('Alpha')
    expect(first[1]).toHaveTextContent('→ #3 CBD Lorville')
    expect(first[1]).toHaveTextContent('SKIPS 1')
    expect(first[2]).toHaveTextContent('Alpha')
    expect(first[2]).toHaveTextContent('→ #2 TDD Area 18')
    expect(first[2]).not.toHaveTextContent('SKIPS')
    // profits: Beta 46×60, Alpha→3 46×50, Alpha→2 46×30
    expect(profits(1)).toEqual(['2,760', '2,300', '1,380'])
  })

  it('shows allowed box sizes next to the commodity name without expanding (criterion 9)', () => {
    seed({
      offers: [
        buyOffer(1, 1, 100, { containerSizes: [8, 16] }),
        sellOffer(1, 2, 150),
        buyOffer(2, 1, 100),
        sellOffer(2, 2, 140),
      ],
      commodities: [commodity(1, { name: 'Bulky' }), commodity(2, { name: 'Handy' })],
      stops: [1, 2],
    })
    render(<TradesView />)
    const [bulky, handy] = lines(1)
    // Bulky: 40 SCU × 50 = 2,000; Handy: 46 SCU × 40 = 1,840
    expect(bulky).toHaveTextContent('Bulky □ 8·16')
    expect(handy).toHaveTextContent('Handy □ 1·2·4·8·16')
    expect(within(bulky).getByRole('button', { name: /details for/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('says what to do at stops without options and at the final stop', () => {
    seed({
      offers: [buyOffer(1, 1, 100), sellOffer(1, 3, 150)],
      commodities: [commodity(1, { name: 'Alpha' })],
    })
    render(<TradesView />)
    expect(within(section(2)).getByText('Nothing profitable to buy here')).toBeInTheDocument()
    expect(within(section(3)).getByText('Final stop — sell only')).toBeInTheDocument()
    expect(within(section(3)).queryByRole('list')).not.toBeInTheDocument()
  })

  it('shows the top 5 and expands the rest with "Show N more"', async () => {
    const many = Array.from({ length: 8 }, (_, i) => commodity(i + 1, { name: `Item ${i + 1}` }))
    const manyOffers = many.flatMap((c) => [buyOffer(c.id, 1, 100), sellOffer(c.id, 2, 100 + c.id)])
    seed({ offers: manyOffers, commodities: many, stops: [1, 2] })
    const user = userEvent.setup()
    render(<TradesView />)
    expect(lines(1)).toHaveLength(5)
    expect(lines(1)[0]).toHaveTextContent('Item 8')
    await user.click(within(section(1)).getByRole('button', { name: 'Show 3 more' }))
    expect(lines(1)).toHaveLength(8)
    await user.click(within(section(1)).getByRole('button', { name: 'Show fewer' }))
    expect(lines(1)).toHaveLength(5)
  })

  it('sorts all stops by ROI, margin per SCU and investment (all descending)', async () => {
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
    const order = () => lines(1).map((l) => l.querySelector('strong')?.textContent)
    expect(order()).toEqual(['Big', 'Mid', 'Cheap'])
    await user.selectOptions(screen.getByLabelText('Sort by'), 'ROI')
    expect(order()).toEqual(['Cheap', 'Mid', 'Big'])
    await user.selectOptions(screen.getByLabelText('Sort by'), 'Margin / SCU')
    expect(order()).toEqual(['Big', 'Mid', 'Cheap'])
    await user.selectOptions(screen.getByLabelText('Sort by'), 'Investment')
    expect(order()).toEqual(['Big', 'Mid', 'Cheap'])
  })

  it('has no plan chips or timeline', () => {
    seed({ offers, commodities })
    render(<TradesView />)
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByText('Plans')).not.toBeInTheDocument()
    expect(screen.queryByText(/Execution timeline/)).not.toBeInTheDocument()
    expect(screen.queryByText('MAX')).not.toBeInTheDocument()
  })

  it('shows small non-interactive badges (max 3 plus a +n chip)', () => {
    seed({ offers, commodities })
    render(<TradesView />)
    const beta = lines(1)[0]
    expect(beta).toHaveTextContent('ILLEGAL')
    expect(beta).toHaveTextContent('SKIPS 1')
    expect(beta).toHaveTextContent('NO STOCK?')
    expect(beta).toHaveTextContent('LOW DEMAND?')
    expect(lines(1)[1]).toHaveTextContent('STALE 9d')
    // Beta: ILLEGAL, SKIPS 1, NO STOCK?, LOW DEMAND? → the fourth sits behind a +1 chip
    expect(beta.querySelector('.badge--more')).toHaveTextContent('+1')
    expect(beta.querySelectorAll('.badge--extra')).toHaveLength(1)
    // buttons on the line: the bought toggle and the details chevron — badges are plain chips
    expect(within(beta).getAllByRole('button')).toHaveLength(2)
  })
})

describe('expanded option line', () => {
  it('toggles on tap and shows every field (criterion 10) including a skip option', async () => {
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
    const user = userEvent.setup()
    render(<TradesView />)
    const line = lines(1)[0]
    expect(within(line).queryByText('Margin / SCU')).not.toBeInTheDocument()
    // buy and sell price are visible without expanding (criterion 10)
    expect(line).toHaveTextContent('BUY 2,810 → SELL 3,315 /SCU')
    expect(line).toHaveTextContent('→ #3 CBD Lorville')
    expect(line).toHaveTextContent('23,230')
    expect(line).toHaveTextContent('18.0%')
    await user.click(within(line).getByRole('button', { name: /Show details/ }))
    expect(within(line).getByRole('button', { name: /Hide details/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(line).toHaveTextContent('Margin / SCU505')
    expect(line).toHaveTextContent('Quantity46 of 46 SCU')
    expect(line).toHaveTextContent('□ 1·2·4·8·16 — 2×16 + 1×8 + 1×4 + 1×2 = 5 boxes')
    expect(line).toHaveTextContent('Investment129,260')
    expect(line).toHaveTextContent('Revenue152,490')
    expect(line).toHaveTextContent('Profit23,230')
    expect(line).toHaveTextContent('ROI18.0%')
    expect(line).toHaveTextContent('LegalityLEGAL')
    expect(line).toHaveTextContent('buy 9h · sell 2d')
    expect(line).toHaveTextContent('SKIPS 1')
    expect(line).toHaveTextContent('Reported — buy: LO · 54 SCU · sell: HI · 14 SCU · stock 2')
    await user.click(within(line).getByRole('button', { name: /Hide details/ }))
    expect(within(line).queryByText('Margin / SCU')).not.toBeInTheDocument()
  })

  it('shows unused SCU with the minimum box when the range leaves a gap', async () => {
    seed({
      offers: [buyOffer(1, 1, 100), sellOffer(1, 2, 150)],
      stops: [1, 2],
      boxMin: 4,
    })
    const user = userEvent.setup()
    render(<TradesView />)
    await user.click(within(lines(1)[0]).getByRole('button', { name: /details for/ }))
    expect(lines(1)[0]).toHaveTextContent('Quantity44 of 46 SCU')
    expect(lines(1)[0]).toHaveTextContent('2 SCU unused · min box 4')
    expect(lines(1)[0]).toHaveTextContent('2×16 + 1×8 + 1×4 = 4 boxes')
  })

  it('explains inventory warnings with the reported values and age instead of tappable badges', async () => {
    seed({
      offers: [
        buyOffer(1, 1, 1000, {
          statusBuy: 1,
          scuBuy: 0,
          scuBuyAvg: 0,
          dateModified: ago(0.375), // 9 h
        }),
        sellOffer(1, 2, 1100, { statusSell: 6 }),
      ],
      stops: [1, 2],
    })
    const user = userEvent.setup()
    render(<TradesView />)
    const line = lines(1)[0]
    expect(line).toHaveTextContent('NO STOCK?')
    await user.click(within(line).getByRole('button', { name: /details for/ }))
    const notes = within(line).getAllByRole('note')
    expect(notes[0]).toHaveTextContent(
      'Reported 9 h ago at the buy stop: stock Out of Stock (0–14 %), 0 SCU. Inventory may have refilled since.',
    )
    expect(notes[1]).toHaveTextContent('demand Very High (72–85 %)')
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
    expect(lines(1)).toHaveLength(1)
    expect(lines(1)[0]).toHaveTextContent('NO STOCK?')
    expect(profits(1)).toEqual(['4,600'])
  })

  it('recomputes immediately when inputs change (criterion 4)', async () => {
    seed({ offers: [buyOffer(1, 1, 100), sellOffer(1, 2, 200)], stops: [1, 2] })
    const user = userEvent.setup()
    const { unmount } = render(<TradesView />)
    expect(profits(1)).toEqual(['4,600'])
    unmount()
    useAppStore.setState({ freeScu: 10 })
    render(<TradesView />)
    expect(profits(1)).toEqual(['1,000'])
    await user.click(within(lines(1)[0]).getByRole('button', { name: /details for/ }))
    expect(lines(1)[0]).toHaveTextContent('Quantity10 of 10 SCU')
  })
})

describe('droppedLines', () => {
  it('pluralizes and skips zero counts', () => {
    expect(
      droppedLines({ boxTooLarge: 0, boxTooSmall: 0, illegal: 0, volatileQt: 0, priceAge: 0 }),
    ).toEqual([])
    expect(
      droppedLines({ boxTooLarge: 2, boxTooSmall: 1, illegal: 0, volatileQt: 0, priceAge: 3 }),
    ).toEqual([
      '2 trades need bigger boxes than your ship takes',
      '1 trade only comes in boxes smaller than your minimum',
      '3 hidden by the price-age filter',
    ])
  })
})

describe('prices on the collapsed line', () => {
  it('formats long values with grouping and labels (4- and 7-digit prices)', () => {
    seed({
      offers: [buyOffer(1, 1, 1_234_567), sellOffer(1, 2, 2_345_678)],
      commodities: [commodity(1, { name: 'Extremely Long Commodity Name Compound' })],
      stops: [1, 2],
      boxMin: 1,
    })
    render(<TradesView />)
    const line = lines(1)[0]
    expect(line).toHaveTextContent('BUY 1,234,567 → SELL 2,345,678 /SCU')
    expect(line).toHaveTextContent('Extremely Long Commodity Name Compound')
    expect(line.querySelector('.option__unit')).toHaveTextContent('aUEC')
  })

  it('does not repeat buy and sell price in the expanded details', async () => {
    seed({ offers: laranite })
    const user = userEvent.setup()
    render(<TradesView />)
    await user.click(within(lines(1)[0]).getByRole('button', { name: /details for/ }))
    expect(lines(1)[0]).not.toHaveTextContent('Buy / SCU')
    expect(lines(1)[0]).not.toHaveTextContent('Sell / SCU')
    expect(lines(1)[0]).toHaveTextContent('Margin / SCU505')
  })
})
