import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMemoryCache } from '../api/cache'
import { resetMapMemory } from '../api/terminalMap'
import { DEFAULT_SUGGEST_OPTIONS } from '../route/suggest'
import type { SuggestJob } from '../route/suggest/run'
import { setSuggestClient } from '../route/suggest/suggestClient'
import { useAppStore } from '../state/useAppStore'
import { useDataStore } from '../state/useDataStore'
import { useSuggestUi } from '../state/useSuggestUi'
import { buyOffer, commodity, sellOffer, terminal } from '../test-utils/calcFixtures'
import { testMap, type TestNode } from '../test-utils/mapFixture'
import { json, urlOf } from '../test-utils/mockFetch'
import { INITIAL_TRIP } from '../trip/tripReducer'
import { RouteView } from './RouteView'

const nodes: TestNode[] = [
  { id: 'station:A', x: 0, terminals: [1] },
  { id: 'station:X', x: 50, terminals: [3] },
  { id: 'station:B', x: 100, terminals: [2] },
  { id: 'station:Y', x: 70, terminals: [4] },
]

function seed(opts: { live?: string; offers?: ReturnType<typeof buyOffer>[] } = {}) {
  const live = opts.live ?? '4.10.2'
  useDataStore.setState({
    staticData: {
      data: {
        commodities: [commodity(1, { name: 'Quartz' }), commodity(2, { name: 'Waste' })],
        terminals: [
          terminal(1, {
            displayname: 'Alpha Station',
            name: 'Alpha Station',
            planetName: 'Hurston',
          }),
          terminal(2, {
            displayname: 'Bravo Station',
            name: 'Bravo Station',
            planetName: 'ArcCorp',
          }),
          terminal(3, {
            displayname: 'Xray Outpost',
            name: 'Xray Outpost',
            planetName: 'Crusader',
          }),
          terminal(4, {
            displayname: 'Yankee Station',
            name: 'Yankee Station',
            planetName: 'MicroTech',
          }),
        ],
        vehicles: [],
        gameVersions: { live, ptu: live },
      },
      fetchedAt: Date.now(),
      gameVersion: live,
      stale: false,
      error: null,
    },
    staticStatus: 'ready',
    prices: {
      data: { offers: opts.offers ?? [buyOffer(1, 3, 100), sellOffer(1, 2, 150)] },
      fetchedAt: Date.now(),
      gameVersion: live,
      stale: false,
      error: null,
    },
    pricesStatus: 'ready',
    pricesError: null,
    offlineError: null,
    refreshing: false,
  })
  useAppStore.setState({ stops: [1, 2], freeScu: 10, boxMin: 1, boxMax: 32, vehicleId: null })
}

function serveMap(versions: string[] = ['4.10.2']) {
  const requested: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input)
      requested.push(url)
      if (url.endsWith('terminal-map/index.json')) return json({ schemaVersion: 2, versions })
      const version = /terminal-map\/(.+)\.json$/.exec(url)?.[1]
      return version && versions.includes(version) ? json(testMap(nodes)) : json({}, 404)
    }),
  )
  return requested
}

const enable = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('checkbox', { name: 'Add profitable stops' }))
const suggestedRows = () => document.querySelectorAll<HTMLElement>('.stop--suggested')
const waitForRows = (n: number) =>
  waitFor(() => expect(suggestedRows()).toHaveLength(n), { timeout: 4000 })

beforeEach(() => {
  localStorage.clear()
  resetMemoryCache()
  resetMapMemory()
  setSuggestClient(null)
  useAppStore.setState(useAppStore.getInitialState(), true)
  useSuggestUi.setState({ dismissed: [] })
  useDataStore.setState(useDataStore.getInitialState(), true)
})

describe('add profitable stops panel', () => {
  it('is off and collapsed by default, with the documented defaults behind the settings', async () => {
    seed()
    const requested = serveMap()
    const user = userEvent.setup()
    render(<RouteView />)
    expect(screen.getByRole('checkbox', { name: 'Add profitable stops' })).not.toBeChecked()
    expect(screen.queryByLabelText('Stops per gap')).not.toBeInTheDocument()
    expect(suggestedRows()).toHaveLength(0)
    expect(requested).toEqual([]) // the map is only fetched when the feature is on
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByLabelText('Stops per gap')).toHaveValue('1')
    expect(screen.getByLabelText('Stops in total')).toHaveValue('4')
    expect(screen.getByLabelText('Stops per planetary group')).toHaveValue('1')
    expect(screen.getByLabelText('Max detour')).toHaveValue('150')
  })

  it('is disabled with a reason when the route has fewer than two stops', () => {
    seed()
    useAppStore.setState({ stops: [1] })
    serveMap()
    render(<RouteView />)
    expect(screen.getByRole('checkbox', { name: 'Add profitable stops' })).toBeDisabled()
    expect(screen.getByText('Add at least two stops first.')).toBeInTheDocument()
  })

  it('persists the options and changes them with the steppers', async () => {
    seed()
    serveMap()
    const user = userEvent.setup()
    render(<RouteView />)
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: 'Increase Stops per gap' }))
    await user.click(screen.getByRole('button', { name: 'Increase Stops in total' }))
    await user.click(screen.getByRole('button', { name: 'Increase Stops per planetary group' }))
    await user.selectOptions(screen.getByLabelText('Max detour'), '200')
    expect(useAppStore.getState().suggest).toEqual({
      ...DEFAULT_SUGGEST_OPTIONS,
      perGap: 2,
      total: 5,
      perGroup: 2,
      detourPct: 200,
    })
    expect(JSON.parse(localStorage.getItem('shc:v1') ?? '{}').state.suggest.detourPct).toBe(200)
  })
})

describe('suggestions in the route list', () => {
  it('loads the map once, then shows a SUGGESTED row with its role and the summary', async () => {
    seed()
    const requested = serveMap()
    const user = userEvent.setup()
    render(<RouteView />)
    await enable(user)
    await waitForRows(1)
    const row = suggestedRows()[0]
    expect(row).toHaveTextContent('SUGGESTED')
    expect(row).toHaveTextContent('Xray Outpost')
    expect(row).toHaveTextContent('Crusader')
    expect(row).toHaveTextContent('buy Quartz → #2')
    expect(row.querySelector('[aria-label^="Drag"], [aria-label^="Move"]')).toBeNull() // no handle
    expect(screen.getByLabelText('Suggestion summary')).toHaveTextContent(
      '+1 stop · route profit 0 → 500 (+500) · distance 100.0 → 100.0 Gm (+0 %)',
    )
    expect(requested).toEqual(['/terminal-map/index.json', '/terminal-map/4.10.2.json'])
    expect(requested.some((u) => u.includes('uexcorp'))).toBe(false)
    // the row sits in the gap after stop 1, before stop 2
    const items = [...document.querySelectorAll('.stops > li')].map((li) =>
      li.hasAttribute('data-suggested') ? 'S' : 'F',
    )
    expect(items).toEqual(['F', 'S', 'F'])
  })

  it('Add inserts the stop as a normal stop at its position and resets the trip', async () => {
    seed()
    serveMap()
    useAppStore.setState({ trip: { currentStop: 1, bought: [] } })
    const user = userEvent.setup()
    render(<RouteView />)
    await enable(user)
    await waitForRows(1)
    await user.click(within(suggestedRows()[0]).getByRole('button', { name: 'Add' }))
    expect(useAppStore.getState().stops).toEqual([1, 3, 2])
    expect(useAppStore.getState().trip).toEqual(INITIAL_TRIP)
    // the suggestion is recomputed for the new route: nothing left to add
    await waitFor(() =>
      expect(screen.getByText('No profitable stops within a 150 % detour')).toBeInTheDocument(),
    )
    expect(suggestedRows()).toHaveLength(0)
    expect(screen.getAllByRole('button', { name: /^Move stop \d (up|down)$/ })).toHaveLength(6)
  })

  it('Add all replaces the route with the suggested one', async () => {
    seed({
      offers: [
        buyOffer(1, 3, 100),
        sellOffer(1, 2, 150),
        buyOffer(2, 2, 100),
        sellOffer(2, 4, 1000),
      ],
    })
    useAppStore.setState({ stops: [1, 2] })
    serveMap()
    const user = userEvent.setup()
    render(<RouteView />)
    await enable(user)
    await waitFor(() => expect(suggestedRows().length).toBeGreaterThan(0), { timeout: 4000 })
    await user.click(screen.getByRole('button', { name: 'Add all' }))
    const stops = useAppStore.getState().stops
    expect(stops.length).toBeGreaterThan(2)
    expect(stops[0]).toBe(1)
    expect(stops).toContain(3)
  })

  it('✕ dismisses a terminal until the route is cleared', async () => {
    seed()
    serveMap()
    const user = userEvent.setup()
    render(<RouteView />)
    await enable(user)
    await waitForRows(1)
    await user.click(
      within(suggestedRows()[0]).getByRole('button', { name: /Dismiss Xray Outpost/ }),
    )
    expect(useSuggestUi.getState().dismissed).toEqual([3])
    expect(useAppStore.getState().stops).toEqual([1, 2]) // dismissing never edits the route
    expect(await screen.findByText('No profitable stops within a 150 % detour')).toBeInTheDocument()
    expect(suggestedRows()).toHaveLength(0)
    // dismissals are UI state only
    expect(localStorage.getItem('shc:v1')).not.toMatch(/dismiss/)
  })

  it('forgets dismissals when the route is cleared', async () => {
    seed()
    serveMap()
    render(<RouteView />)
    useSuggestUi.getState().dismiss(3)
    useAppStore.getState().clearStops()
    await waitFor(() => expect(useSuggestUi.getState().dismissed).toEqual([]))
  })

  it('says so when nothing qualifies and follows the detour setting in the message', async () => {
    seed({ offers: [] })
    serveMap()
    useAppStore.getState().setSuggestOptions({ detourPct: 120 })
    const user = userEvent.setup()
    render(<RouteView />)
    await enable(user)
    await waitFor(
      () =>
        expect(screen.getByText('No profitable stops within a 120 % detour')).toBeInTheDocument(),
      { timeout: 4000 },
    )
  })

  it('shows "searching…" while the search runs', async () => {
    seed()
    serveMap()
    const user = userEvent.setup()
    render(<RouteView />)
    await enable(user)
    expect(screen.getByText('Searching…')).toBeInTheDocument()
    await waitForRows(1)
    expect(screen.queryByText('Searching…')).not.toBeInTheDocument()
  })

  it('notes when the map is older than the LIVE game version', async () => {
    seed({ live: '4.11.0' })
    serveMap(['4.10.2'])
    const user = userEvent.setup()
    render(<RouteView />)
    await enable(user)
    await waitForRows(1)
    expect(screen.getByText('Map from 4.10.2')).toBeInTheDocument()
  })

  it('shows why it cannot work when the map cannot be loaded', async () => {
    seed()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')))
    const user = userEvent.setup()
    render(<RouteView />)
    await enable(user)
    expect(await screen.findByText(/Could not load the terminal map/)).toBeInTheDocument()
    expect(suggestedRows()).toHaveLength(0)
  })

  it('drag reordering still maps to the fixed stops while suggestions are shown', async () => {
    seed()
    serveMap()
    useAppStore.setState({ stops: [1, 4, 2] })
    const user = userEvent.setup()
    render(<RouteView />)
    await enable(user)
    await waitFor(() => expect(document.querySelectorAll('[data-stop-row]')).toHaveLength(3))
    await user.click(screen.getByRole('button', { name: 'Move stop 2 up' }))
    expect(useAppStore.getState().stops).toEqual([4, 1, 2])
  })
})

describe('calc settings reach the search worker (revision 14)', () => {
  it('sends the small-hangar toggle and the stock filter with every request', async () => {
    seed()
    serveMap()
    const jobs: SuggestJob[] = []
    setSuggestClient({
      run: (job) => {
        jobs.push(job)
        return Promise.resolve({ kind: 'none', bestFound: false })
      },
      dispose: () => {},
    })
    useAppStore.setState({ smallHangar: true, hideLowStock: true })
    const user = userEvent.setup()
    render(<RouteView />)
    await enable(user)
    await waitFor(() => expect(jobs.length).toBeGreaterThan(0), { timeout: 4000 })
    expect(jobs.at(-1)?.request.calc).toMatchObject({
      smallHangar: true,
      options: { hideLowStock: true },
    })
    // changing a setting triggers a new request carrying the new value
    useAppStore.getState().setSmallHangar(false)
    await waitFor(() => expect(jobs.at(-1)?.request.calc.smallHangar).toBe(false), {
      timeout: 4000,
    })
  })
})

describe('section order (§7.4)', () => {
  it('lists the stops first, then Add stop, the route actions and Add profitable stops last', async () => {
    seed()
    serveMap()
    const user = userEvent.setup()
    render(<RouteView />)
    await enable(user)
    await waitForRows(1)
    const list = screen.getByRole('list', { name: 'Route stops' })
    const addStop = screen.getByRole('region', { name: 'Add stop' })
    const reverse = screen.getByRole('button', { name: 'Reverse route' })
    const profitable = screen.getByRole('region', { name: 'Add profitable stops' })
    const before = (a: Node, b: Node) =>
      expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    before(list, addStop)
    before(addStop, reverse)
    before(reverse, profitable)
  })

  it('keeps the summary, the budget and ADD ALL inside the profitable-stops section', async () => {
    seed()
    serveMap()
    const user = userEvent.setup()
    render(<RouteView />)
    await enable(user)
    await waitForRows(1)
    const section = screen.getByRole('region', { name: 'Add profitable stops' })
    expect(within(section).getByLabelText('Suggestion summary')).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Add all' })).toBeInTheDocument()
    expect(within(section).getByLabelText('Dynamic stop budget')).toHaveTextContent(
      'dynamic stops 0 / 4 used',
    )
    // only one summary exists, and it comes after the stop list
    const list = screen.getByRole('list', { name: 'Route stops' })
    expect(screen.getAllByLabelText('Suggestion summary')).toHaveLength(1)
    expect(
      list.compareDocumentPosition(screen.getByLabelText('Suggestion summary')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})

describe('accepted dynamic stops keep counting (§6.7, §7.4)', () => {
  // Quartz X → Y (500) and Waste Y → B (500): with one stop per gap only Y pays (500);
  // once Y is accepted, X must not be offered although it would add another 500.
  const twoStopOffers = [
    buyOffer(1, 3, 100),
    sellOffer(1, 4, 150),
    buyOffer(2, 4, 100),
    sellOffer(2, 2, 150),
  ]
  const dynamicRoute = () =>
    useAppStore.setState({ stops: [1, 4, 2], origins: ['fixed', 'dynamic', 'fixed'] })

  it('marks accepted stops DYNAMIC and shows the used budget', async () => {
    seed({ offers: twoStopOffers })
    serveMap()
    const user = userEvent.setup()
    render(<RouteView />)
    await enable(user)
    await waitForRows(1)
    expect(suggestedRows()[0]).toHaveTextContent('Yankee Station')
    expect(screen.queryByText('DYNAMIC')).not.toBeInTheDocument()
    await user.click(within(suggestedRows()[0]).getByRole('button', { name: 'Add' }))
    expect(useAppStore.getState().stops).toEqual([1, 4, 2])
    expect(useAppStore.getState().origins).toEqual(['fixed', 'dynamic', 'fixed'])
    const rows = document.querySelectorAll<HTMLElement>('[data-stop-row]')
    expect(rows[0]).not.toHaveTextContent('DYNAMIC')
    expect(rows[1]).toHaveTextContent('Yankee Station')
    expect(rows[1]).toHaveTextContent('DYNAMIC')
    expect(rows[2]).not.toHaveTextContent('DYNAMIC')
    // the accepted stop is a normal row: number, reorder buttons, remove
    expect(within(rows[1]).getByRole('button', { name: 'Remove stop 2' })).toBeVisible()
    await waitFor(() =>
      expect(screen.getByLabelText('Dynamic stop budget')).toHaveTextContent(
        'dynamic stops 1 / 4 used',
      ),
    )
  })

  it('does not free the per-gap budget after Add: no further stop in a full gap', async () => {
    seed({ offers: twoStopOffers })
    serveMap()
    const user = userEvent.setup()
    render(<RouteView />)
    await enable(user)
    await waitForRows(1)
    await user.click(within(suggestedRows()[0]).getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(screen.getByText('No profitable stops within a 150 % detour')).toBeInTheDocument(),
    )
    expect(suggestedRows()).toHaveLength(0)
    expect(useAppStore.getState().stops).toEqual([1, 4, 2])
  })

  it('suggests the rest of the gap once the per-gap limit allows it, in front of the accepted stop', async () => {
    seed({ offers: twoStopOffers })
    serveMap()
    dynamicRoute()
    useAppStore.getState().setSuggestOptions({ perGap: 2 })
    const user = userEvent.setup()
    render(<RouteView />)
    await enable(user)
    await waitForRows(1)
    expect(suggestedRows()[0]).toHaveTextContent('Xray Outpost')
    const items = [...document.querySelectorAll('.stops > li')].map((li) =>
      li.hasAttribute('data-suggested') ? 'S' : li.textContent?.includes('DYNAMIC') ? 'D' : 'F',
    )
    expect(items).toEqual(['F', 'S', 'D', 'F']) // X sits before the accepted Y
    await user.click(within(suggestedRows()[0]).getByRole('button', { name: 'Add' }))
    expect(useAppStore.getState().stops).toEqual([1, 3, 4, 2])
    expect(useAppStore.getState().origins).toEqual(['fixed', 'dynamic', 'dynamic', 'fixed'])
  })

  it('Add all marks every added stop dynamic and keeps the existing origins', async () => {
    seed({ offers: twoStopOffers })
    serveMap()
    useAppStore.getState().setSuggestOptions({ perGap: 2 })
    const user = userEvent.setup()
    render(<RouteView />)
    await enable(user)
    await waitForRows(2)
    await user.click(screen.getByRole('button', { name: 'Add all' }))
    expect(useAppStore.getState().stops).toEqual([1, 3, 4, 2])
    expect(useAppStore.getState().origins).toEqual(['fixed', 'dynamic', 'dynamic', 'fixed'])
    expect(useAppStore.getState().trip).toEqual(INITIAL_TRIP)
  })

  it('says so when the accepted stops use up the total, and removes nothing', async () => {
    seed({ offers: twoStopOffers })
    serveMap()
    dynamicRoute()
    useAppStore.getState().setSuggestOptions({ perGap: 2, total: 1 })
    const user = userEvent.setup()
    render(<RouteView />)
    await enable(user)
    expect(await screen.findByText('1 of 1 dynamic stops used')).toBeInTheDocument()
    expect(suggestedRows()).toHaveLength(0)
    expect(useAppStore.getState().stops).toEqual([1, 4, 2])
  })

  it('disables the option while fewer than two fixed stops are left', () => {
    seed()
    serveMap()
    useAppStore.setState({ stops: [1, 4], origins: ['fixed', 'dynamic'] })
    render(<RouteView />)
    expect(screen.getByRole('checkbox', { name: 'Add profitable stops' })).toBeDisabled()
  })

  it('removing a dynamic stop frees its budget', async () => {
    seed({ offers: twoStopOffers })
    serveMap()
    dynamicRoute()
    const user = userEvent.setup()
    render(<RouteView />)
    await enable(user)
    await user.click(screen.getByRole('button', { name: 'Remove stop 2' }))
    await waitForRows(1)
    expect(suggestedRows()[0]).toHaveTextContent('Yankee Station')
    expect(screen.getByLabelText('Dynamic stop budget')).toHaveTextContent(
      'dynamic stops 0 / 4 used',
    )
  })
})
