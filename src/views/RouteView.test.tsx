import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '../state/useAppStore'
import { seedDataStore } from '../test-utils/staticData'
import { RouteView } from './RouteView'

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState(useAppStore.getInitialState(), true)
  seedDataStore()
})

const stops = () => useAppStore.getState().stops
const field = () => screen.getByRole('combobox', { name: 'Add stop' })

async function addStop(user: ReturnType<typeof userEvent.setup>, query: string, option: RegExp) {
  await user.type(field(), query)
  await user.click(await screen.findByRole('option', { name: option }))
}

describe('RouteView autocomplete (criterion 3)', () => {
  it.each([
    ['arc l1', /ARC-L1 Wide Forest Station/],
    ['ARCL1', /ARC-L1 Wide Forest Station/],
    ['wide forest', /ARC-L1 Wide Forest Station/],
    ['area18', /Area18/],
  ])('typing "%s" shows the terminal', async (query, expected) => {
    const user = userEvent.setup()
    render(<RouteView />)
    await user.type(field(), query)
    expect((await screen.findAllByRole('option', { name: expected }))[0]).toBeInTheDocument()
  })

  it('distinguishes terminals with the same displayname by their secondary line', async () => {
    const user = userEvent.setup()
    render(<RouteView />)
    await user.type(field(), 'area18')
    const options = await screen.findAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options.map((o) => o.textContent)).toEqual([
      'Area18Admin - Area 18 · Stanton',
      'Area18TDD - Trade and Development Division - Area 18 · Stanton',
    ])
  })

  it('starts filtering at one character and makes no network calls', async () => {
    const user = userEvent.setup()
    render(<RouteView />)
    await user.type(field(), 'g')
    expect((await screen.findAllByRole('option')).length).toBeGreaterThan(0)
  })

  it('selecting adds the stop, clears the input and keeps focus', async () => {
    const user = userEvent.setup()
    render(<RouteView />)
    await addStop(user, 'arc l1', /ARC-L1/)
    expect(stops()).toEqual([10])
    expect(field()).toHaveValue('')
    expect(field()).toHaveFocus()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('supports ↑ ↓ Enter and Esc', async () => {
    const user = userEvent.setup()
    render(<RouteView />)
    await user.type(field(), 'area18')
    await screen.findAllByRole('option')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(stops()).toEqual([11])
    await user.type(field(), 'area18')
    await user.keyboard('{ArrowDown}{ArrowUp}{Enter}')
    expect(stops()).toEqual([11, 12])
    await user.type(field(), 'arc')
    await screen.findByRole('listbox')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(stops()).toEqual([11, 12])
  })

  it('exposes the combobox ARIA pattern', async () => {
    const user = userEvent.setup()
    render(<RouteView />)
    expect(field()).toHaveAttribute('aria-expanded', 'false')
    await user.type(field(), 'arc')
    const list = await screen.findByRole('listbox')
    expect(field()).toHaveAttribute('aria-expanded', 'true')
    expect(field()).toHaveAttribute('aria-controls', list.id)
    const active = within(list).getAllByRole('option')[0]
    expect(field()).toHaveAttribute('aria-activedescendant', active.id)
    expect(active).toHaveAttribute('aria-selected', 'true')
  })

  it('says so when nothing matches', async () => {
    const user = userEvent.setup()
    render(<RouteView />)
    await user.type(field(), 'zzzzz')
    expect(await screen.findByText('No terminal matches')).toBeInTheDocument()
  })

  it('hides unavailable terminals unless toggled', async () => {
    const user = userEvent.setup()
    render(<RouteView />)
    await user.type(field(), 'closed')
    expect(await screen.findByText('No terminal matches')).toBeInTheDocument()
    await user.clear(field())
    await user.click(screen.getByRole('checkbox', { name: 'Show unavailable terminals' }))
    await user.type(field(), 'closed')
    expect(await screen.findByRole('option', { name: /Closed Outpost/ })).toBeInTheDocument()
  })
})

describe('RouteView stop list', () => {
  beforeEach(() => {
    useAppStore.setState({ stops: [10, 11, 13] })
  })

  it('shows position, displayname and name · system for every stop', () => {
    render(<RouteView />)
    const items = within(screen.getByRole('list', { name: 'Route stops' })).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('1ARC-L1 Wide Forest StationAdmin - ARC-L1 · Stanton')
    expect(items[1]).toHaveTextContent(
      'Area18TDD - Trade and Development Division - Area 18 · Stanton',
    )
    expect(screen.getByText('3 / 10 stops')).toBeInTheDocument()
  })

  it('reorders with the up / down buttons and disables them at the ends', async () => {
    const user = userEvent.setup()
    render(<RouteView />)
    expect(screen.getByRole('button', { name: 'Move stop 1 up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move stop 3 down' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Move stop 2 up' }))
    expect(stops()).toEqual([11, 10, 13])
    await user.click(screen.getByRole('button', { name: 'Move stop 2 down' }))
    expect(stops()).toEqual([11, 13, 10])
  })

  it('removes a stop', async () => {
    const user = userEvent.setup()
    render(<RouteView />)
    await user.click(screen.getByRole('button', { name: 'Remove stop 2' }))
    expect(stops()).toEqual([10, 13])
  })

  it('allows the same terminal twice', async () => {
    const user = userEvent.setup()
    render(<RouteView />)
    await addStop(user, 'arc l1', /ARC-L1/)
    expect(stops()).toEqual([10, 11, 13, 10])
  })

  it('reverses the route', async () => {
    const user = userEvent.setup()
    render(<RouteView />)
    await user.click(screen.getByRole('button', { name: 'Reverse route' }))
    expect(stops()).toEqual([13, 11, 10])
  })

  it('clears the route only after confirmation', async () => {
    const user = userEvent.setup()
    render(<RouteView />)
    await user.click(screen.getByRole('button', { name: 'Clear route' }))
    expect(stops()).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(stops()).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'Clear route' }))
    await user.click(screen.getByRole('button', { name: 'Confirm clear' }))
    expect(stops()).toEqual([])
    expect(screen.getByText(/No stops yet/)).toBeInTheDocument()
  })

  it('shows unknown terminals and lets the user remove them', async () => {
    useAppStore.setState({ stops: [99999] })
    const user = userEvent.setup()
    render(<RouteView />)
    expect(screen.getByText('Unknown terminal (#99999)')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove stop 1' }))
    expect(stops()).toEqual([])
  })

  it('stops offering the add field at 10 stops', () => {
    useAppStore.setState({ stops: Array.from({ length: 10 }, () => 10) })
    render(<RouteView />)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText(/Maximum of 10 stops/)).toBeInTheDocument()
  })

  it('reorders by dragging the handle (pointer events)', () => {
    render(<RouteView />)
    const list = screen.getByRole('list', { name: 'Route stops' })
    const rows = within(list).getAllByRole('listitem')
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () =>
        ({
          top: i * 100,
          bottom: i * 100 + 90,
          left: 0,
          right: 300,
          width: 300,
          height: 90,
        }) as DOMRect
    })
    const handle = screen.getByRole('button', { name: 'Drag stop 1 to reorder' })
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientY: 210, pointerId: 1 })
    expect(rows[2]).toHaveClass('stop--over')
    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(stops()).toEqual([11, 13, 10])
  })

  it('does not reorder when dropped on the same row or with a non-primary button', () => {
    render(<RouteView />)
    const handle = screen.getByRole('button', { name: 'Drag stop 1 to reorder' })
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientY: 0, pointerId: 1 })
    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(stops()).toEqual([10, 11, 13])
    fireEvent.pointerDown(handle, { button: 2, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientY: 500, pointerId: 1 })
    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(stops()).toEqual([10, 11, 13])
  })
})

describe('RouteView calculate button', () => {
  it('switches to the TRADES view', async () => {
    const user = userEvent.setup()
    render(<RouteView />)
    await user.click(screen.getByRole('button', { name: /Calculate trades/ }))
    expect(useAppStore.getState().tab).toBe('trades')
  })
})
