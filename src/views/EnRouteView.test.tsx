import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMemoryCache } from '../api/cache'
import { resetMapMemory } from '../api/terminalMap'
import App from '../App'
import { DEFAULT_SUGGEST_OPTIONS } from '../route/suggest'
import type { SuggestJob } from '../route/suggest/run'
import { setSuggestClient, type SuggestClient } from '../route/suggest/suggestClient'
import { useAppStore } from '../state/useAppStore'
import { useDataStore } from '../state/useDataStore'
import { useSuggestUi } from '../state/useSuggestUi'
import { buyOffer, commodity, sellOffer, terminal } from '../test-utils/calcFixtures'
import { testMap, type TestNode } from '../test-utils/mapFixture'
import { json, urlOf } from '../test-utils/mockFetch'
import { INITIAL_TRIP } from '../trip/tripReducer'
import { EnRouteView } from './EnRouteView'

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
          // an outpost without an armistice zone
          terminal(3, {
            displayname: 'Xray Outpost',
            name: 'Xray Outpost',
            planetName: 'Crusader',
            idSpaceStation: 0,
            idOutpost: 9,
            safeLoading: false,
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

const suggestedRows = () => document.querySelectorAll<HTMLElement>('.stop--suggested')
const routeRows = () => document.querySelectorAll<HTMLElement>('.stops > li:not(.stop--suggested)')
const waitForRows = (n: number) =>
  waitFor(() => expect(suggestedRows()).toHaveLength(n), { timeout: 4000 })

beforeEach(() => {
  localStorage.clear()
  resetMemoryCache()
  resetMapMemory()
  setSuggestClient(null)
  useAppStore.setState(useAppStore.getInitialState(), true)
  useSuggestUi.setState({ dismissed: [], routeKey: '' })
  useDataStore.setState(useDataStore.getInitialState(), true)
})

describe('EN ROUTE settings', () => {
  it('shows the four steppers directly (no toggle) with the documented defaults', async () => {
    seed()
    const requested = serveMap()
    render(<EnRouteView />)
    expect(screen.queryByRole('checkbox', { name: 'Add profitable stops' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Stops per gap')).toHaveValue('1')
    expect(screen.getByLabelText('Stops in total')).toHaveValue('4')
    expect(screen.getByLabelText('Stops per planetary group')).toHaveValue('1')
    expect(screen.getByLabelText('Max detour')).toHaveValue('150')
    expect(screen.getByRole('checkbox', { name: 'Safe loading only' })).not.toBeChecked()
    await waitFor(() => expect(requested.length).toBeGreaterThan(0)) // the search starts at once
  })

  it('replaces the suggestion sections with a hint to ROUTE for fewer than two stops', () => {
    seed()
    useAppStore.setState({ stops: [1] })
    serveMap()
    render(<EnRouteView />)
    expect(screen.getByText(/Add at least two stops on ROUTE/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Stops per gap')).not.toBeInTheDocument()
    // the filters stay usable
    expect(screen.getByRole('checkbox', { name: 'Include illegal commodities' })).toBeEnabled()
    expect(screen.getByRole('checkbox', { name: 'Safe loading only' })).toBeEnabled()
  })

  it('persists the options and changes them with the steppers', async () => {
    seed()
    serveMap()
    const user = userEvent.setup()
    render(<EnRouteView />)
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

  it('moves the trade filters here with the same persisted keys', async () => {
    seed()
    serveMap()
    const user = userEvent.setup()
    render(<EnRouteView />)
    await user.click(screen.getByRole('checkbox', { name: 'Include illegal commodities' }))
    await user.click(screen.getByRole('checkbox', { name: 'Include quantum-volatile commodities' }))
    await user.click(screen.getByRole('checkbox', { name: 'Hide low stock & demand' }))
    await user.selectOptions(screen.getByLabelText('Max price age'), '3')
    expect(useAppStore.getState()).toMatchObject({
      includeIllegal: false,
      includeVolatileQt: true,
      hideLowStock: true,
      maxPriceAgeDays: 3,
    })
    const saved = JSON.parse(localStorage.getItem('shc:v1') ?? '{}').state
    expect(saved).toMatchObject({ includeIllegal: false, hideLowStock: true, maxPriceAgeDays: 3 })
  })
})

describe('suggestions in the route list', () => {
  it('loads the map once, then shows a SUGGESTED row with its role and the summary', async () => {
    seed()
    const requested = serveMap()
    render(<EnRouteView />)
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
    render(<EnRouteView />)
    await waitForRows(1)
    await user.click(within(suggestedRows()[0]).getByRole('button', { name: 'Add' }))
    expect(useAppStore.getState().stops).toEqual([1, 3, 2])
    expect(useAppStore.getState().trip).toEqual(INITIAL_TRIP)
    // the suggestion is recomputed for the new route: nothing left to add
    await waitFor(() =>
      expect(screen.getByText('No profitable stops within a 150 % detour')).toBeInTheDocument(),
    )
    expect(suggestedRows()).toHaveLength(0)
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
    render(<EnRouteView />)
    await waitFor(() => expect(suggestedRows().length).toBeGreaterThan(0), { timeout: 4000 })
    await user.click(screen.getByRole('button', { name: 'Add all' }))
    const stops = useAppStore.getState().stops
    expect(stops.length).toBeGreaterThan(2)
    expect(stops[0]).toBe(1)
    expect(stops).toContain(3)
  })

  it('✕ dismisses a terminal for this route only', async () => {
    seed()
    serveMap()
    const user = userEvent.setup()
    const view = render(<EnRouteView />)
    await waitForRows(1)
    await user.click(
      within(suggestedRows()[0]).getByRole('button', { name: /Dismiss Xray Outpost/ }),
    )
    expect(useSuggestUi.getState().dismissed).toEqual([3])
    expect(useAppStore.getState().stops).toEqual([1, 2]) // dismissing never edits the route
    expect(await screen.findByText('No profitable stops within a 150 % detour')).toBeInTheDocument()
    expect(suggestedRows()).toHaveLength(0)
    // dismissals are UI state only: no persisted block list
    expect(localStorage.getItem('shc:v1')).not.toMatch(/dismiss/)
    // still dismissed after leaving EN ROUTE and coming back to the same route
    view.unmount()
    render(<EnRouteView />)
    await screen.findByText('No profitable stops within a 150 % detour')
    expect(useSuggestUi.getState().dismissed).toEqual([3])
  })

  it('forgets dismissals when the route is cleared or its fixed stops change', async () => {
    seed()
    serveMap()
    render(<EnRouteView />)
    await waitFor(() => expect(useSuggestUi.getState().routeKey).toBe('1,2'))
    useSuggestUi.getState().dismiss(3)
    useAppStore.getState().clearStops()
    await waitFor(() => expect(useSuggestUi.getState().dismissed).toEqual([]))

    useAppStore.getState().addStop(1)
    useAppStore.getState().addStop(2)
    await waitFor(() => expect(useSuggestUi.getState().routeKey).toBe('1,2'))
    useSuggestUi.getState().dismiss(3)
    useAppStore.getState().addStop(4) // another fixed stop: a different route
    await waitFor(() => expect(useSuggestUi.getState().dismissed).toEqual([]))
  })

  it('keeps dismissals when only a dynamic stop is added', async () => {
    seed()
    serveMap()
    render(<EnRouteView />)
    await waitFor(() => expect(useSuggestUi.getState().routeKey).toBe('1,2'))
    useSuggestUi.getState().dismiss(3)
    useAppStore.getState().insertStop(1, 4, 'dynamic')
    await waitFor(() => expect(routeRows()).toHaveLength(3))
    expect(useSuggestUi.getState().dismissed).toEqual([3])
  })

  it('says so when nothing qualifies and follows the detour setting in the message', async () => {
    seed({ offers: [] })
    serveMap()
    useAppStore.getState().setSuggestOptions({ detourPct: 120 })
    render(<EnRouteView />)
    await waitFor(
      () =>
        expect(screen.getByText('No profitable stops within a 120 % detour')).toBeInTheDocument(),
      { timeout: 4000 },
    )
  })

  it('shows "searching…" while the search runs', async () => {
    seed()
    serveMap()
    render(<EnRouteView />)
    expect(screen.getByText('Searching…')).toBeInTheDocument()
    await waitForRows(1)
    expect(screen.queryByText('Searching…')).not.toBeInTheDocument()
  })

  it('notes when the map is older than the LIVE game version', async () => {
    seed({ live: '4.11.0' })
    serveMap(['4.10.2'])
    render(<EnRouteView />)
    await waitForRows(1)
    expect(screen.getByText('Map from 4.10.2')).toBeInTheDocument()
  })

  it('shows why it cannot work when the map cannot be loaded', async () => {
    seed()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')))
    render(<EnRouteView />)
    expect(await screen.findByText(/Could not load the terminal map/)).toBeInTheDocument()
    expect(suggestedRows()).toHaveLength(0)
  })

  it('has no drag handle or reorder buttons: reordering stays in ROUTE', async () => {
    seed()
    serveMap()
    useAppStore.setState({ stops: [1, 4, 2], origins: ['fixed', 'dynamic', 'fixed'] })
    render(<EnRouteView />)
    await waitFor(() => expect(routeRows()).toHaveLength(3))
    expect(screen.queryByRole('button', { name: /Drag stop|Move stop/ })).not.toBeInTheDocument()
  })
})

describe('calc settings reach the search worker', () => {
  it('sends the small-hangar toggle, the stock filter and the budget with every request', async () => {
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
    useAppStore.setState({ smallHangar: true, hideLowStock: true, budget: 250_000 })
    render(<EnRouteView />)
    await waitFor(() => expect(jobs.length).toBeGreaterThan(0), { timeout: 4000 })
    expect(jobs.at(-1)?.request.calc).toMatchObject({
      smallHangar: true,
      budget: 250_000,
      options: { hideLowStock: true },
    })
    // changing a setting triggers a new request carrying the new value
    useAppStore.getState().setSmallHangar(false)
    await waitFor(() => expect(jobs.at(-1)?.request.calc.smallHangar).toBe(false), {
      timeout: 4000,
    })
  })

  it('sends "safe loading only" in the options, and toggling it searches again', async () => {
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
    const user = userEvent.setup()
    render(<EnRouteView />)
    await waitFor(() => expect(jobs.length).toBeGreaterThan(0), { timeout: 4000 })
    expect(jobs.at(-1)?.request.options.safeLoadingOnly).toBe(false)
    await user.click(screen.getByRole('checkbox', { name: 'Safe loading only' }))
    await waitFor(() => expect(jobs.at(-1)?.request.options.safeLoadingOnly).toBe(true), {
      timeout: 4000,
    })
  })

  it('names "safe loading" when nothing qualifies with it on', async () => {
    seed()
    serveMap()
    useAppStore.getState().setSuggestOptions({ safeLoadingOnly: true })
    render(<EnRouteView />)
    // the only suggestion would be the unsafe Xray Outpost
    expect(
      await screen.findByText('No profitable stops within a 150 % detour with safe loading', {
        exact: false,
      }),
    ).toBeInTheDocument()
    expect(suggestedRows()).toHaveLength(0)
  })
})

describe('safe loading (§6.8)', () => {
  it('suggests an unsafe outpost with the option off, marked NO SAFE ZONE', async () => {
    seed()
    serveMap()
    render(<EnRouteView />)
    await waitForRows(1)
    expect(suggestedRows()[0]).toHaveTextContent('Xray Outpost')
    expect(suggestedRows()[0]).toHaveTextContent('NO SAFE ZONE')
  })

  it('marks route stops without safe loading, whether the option is on or off', async () => {
    seed()
    serveMap()
    useAppStore.setState({ stops: [1, 3, 2], origins: ['fixed', 'fixed', 'fixed'] })
    const user = userEvent.setup()
    render(<EnRouteView />)
    const badges = () =>
      [...document.querySelectorAll('.stops > li')].map((li) =>
        li.textContent?.includes('NO SAFE ZONE'),
      )
    expect(badges()).toEqual([false, true, false])
    await user.click(screen.getByRole('checkbox', { name: 'Safe loading only' }))
    expect(badges()).toEqual([false, true, false]) // fixed stops are never filtered
  })
})

describe('route rows', () => {
  it('only dynamic stops have a remove button', async () => {
    seed()
    serveMap()
    useAppStore.setState({ stops: [1, 4, 2], origins: ['fixed', 'dynamic', 'fixed'] })
    const user = userEvent.setup()
    render(<EnRouteView />)
    expect(screen.getAllByRole('button', { name: /^Remove stop/ })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Remove stop 2' }))
    expect(useAppStore.getState().stops).toEqual([1, 2])
  })
})

describe('section order (§7.4a)', () => {
  it('lists the filters, the stop filter, the settings, the route and the summary top to bottom', async () => {
    seed()
    serveMap()
    render(<EnRouteView />)
    await waitForRows(1)
    const sections = [
      screen.getByRole('region', { name: 'Filters' }),
      screen.getByRole('region', { name: 'Stop filter' }),
      screen.getByRole('region', { name: 'Suggestion settings' }),
      screen.getByRole('list', { name: 'Route with suggestions' }),
      screen.getByRole('region', { name: 'Suggestion summary' }),
    ]
    for (let i = 1; i < sections.length; i++) {
      expect(
        sections[i - 1].compareDocumentPosition(sections[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    }
  })

  it('keeps the summary, the budget and ADD ALL together under the list', async () => {
    seed()
    serveMap()
    render(<EnRouteView />)
    await waitForRows(1)
    const section = screen.getByRole('region', { name: 'Suggestion summary' })
    expect(within(section).getByRole('button', { name: 'Add all' })).toBeInTheDocument()
    expect(within(section).getByLabelText('Dynamic stop budget')).toHaveTextContent(
      'dynamic stops 0 / 4 used',
    )
    expect(screen.getAllByLabelText('Suggestion summary')).toHaveLength(1)
  })

  it('has a CALCULATE TRADES button to the TRADES step', async () => {
    seed()
    serveMap()
    const user = userEvent.setup()
    render(<EnRouteView />)
    await user.click(screen.getByRole('button', { name: /Calculate trades/ }))
    expect(useAppStore.getState().tab).toBe('trades')
  })
})

describe('the search runs only while EN ROUTE is open (§6.7)', () => {
  const countingClient = () => {
    const run = vi.fn<SuggestClient['run']>(() =>
      Promise.resolve({ kind: 'none', bestFound: false }),
    )
    const dispose = vi.fn<SuggestClient['dispose']>()
    setSuggestClient({ run, dispose })
    return { run, dispose }
  }

  it('sends no request and loads no map on the other steps', async () => {
    seed()
    const requested = serveMap()
    const { run } = countingClient()
    for (const tab of ['ship', 'route', 'trades'] as const) {
      useAppStore.setState({ tab })
      const view = render(<App />)
      await new Promise((resolve) => setTimeout(resolve, 450)) // longer than the debounce
      view.unmount()
    }
    expect(run).not.toHaveBeenCalled()
    expect(requested.some((u) => u.includes('terminal-map'))).toBe(false)
  })

  it('starts when EN ROUTE opens and drops the pending result when it closes', async () => {
    seed()
    serveMap()
    const { run, dispose } = countingClient()
    useAppStore.setState({ tab: 'enroute' })
    const view = render(<App />)
    await waitFor(() => expect(run).toHaveBeenCalled(), { timeout: 4000 })
    view.unmount()
    expect(dispose).toHaveBeenCalled()
  })

  it('ignores a persisted enabled flag from the old toggle', async () => {
    seed()
    localStorage.setItem(
      'shc:v1',
      JSON.stringify({
        version: 1,
        state: { tab: 'route', suggest: { enabled: false, perGap: 2 } },
      }),
    )
    await useAppStore.persist.rehydrate()
    expect(useAppStore.getState().suggest).toEqual({ ...DEFAULT_SUGGEST_OPTIONS, perGap: 2 })
    const requested = serveMap()
    const { run } = countingClient()
    render(<App />) // opens on ROUTE: nothing is searched
    await new Promise((resolve) => setTimeout(resolve, 450))
    expect(run).not.toHaveBeenCalled()
    expect(requested.some((u) => u.includes('terminal-map'))).toBe(false)
  })
})

describe('accepted dynamic stops keep counting (§6.7, §7.4a)', () => {
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
    render(<EnRouteView />)
    await waitForRows(1)
    expect(suggestedRows()[0]).toHaveTextContent('Yankee Station')
    expect(screen.queryByText('DYNAMIC')).not.toBeInTheDocument()
    await user.click(within(suggestedRows()[0]).getByRole('button', { name: 'Add' }))
    expect(useAppStore.getState().stops).toEqual([1, 4, 2])
    expect(useAppStore.getState().origins).toEqual(['fixed', 'dynamic', 'fixed'])
    const rows = routeRows()
    expect(rows[0]).not.toHaveTextContent('DYNAMIC')
    expect(rows[1]).toHaveTextContent('Yankee Station')
    expect(rows[1]).toHaveTextContent('DYNAMIC')
    expect(rows[2]).not.toHaveTextContent('DYNAMIC')
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
    render(<EnRouteView />)
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
    render(<EnRouteView />)
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
    render(<EnRouteView />)
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
    render(<EnRouteView />)
    expect(await screen.findByText('1 of 1 dynamic stops used')).toBeInTheDocument()
    expect(suggestedRows()).toHaveLength(0)
    expect(useAppStore.getState().stops).toEqual([1, 4, 2])
  })

  it('shows the hint instead of suggestions while fewer than two fixed stops are left', () => {
    seed()
    serveMap()
    useAppStore.setState({ stops: [1, 4], origins: ['fixed', 'dynamic'] })
    render(<EnRouteView />)
    expect(screen.getByText(/Add at least two stops on ROUTE/)).toBeInTheDocument()
  })

  it('removing a dynamic stop frees its budget', async () => {
    seed({ offers: twoStopOffers })
    serveMap()
    dynamicRoute()
    const user = userEvent.setup()
    render(<EnRouteView />)
    await user.click(screen.getByRole('button', { name: 'Remove stop 2' }))
    await waitForRows(1)
    expect(suggestedRows()[0]).toHaveTextContent('Yankee Station')
    expect(screen.getByLabelText('Dynamic stop budget')).toHaveTextContent(
      'dynamic stops 0 / 4 used',
    )
  })
})
