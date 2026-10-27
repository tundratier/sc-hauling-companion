import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { UexError } from '../api/uexClient'
import { useAppStore } from '../state/useAppStore'
import { useDataStore } from '../state/useDataStore'
import { seedDataStore } from '../test-utils/staticData'
import { ShipView } from './ShipView'

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState(useAppStore.getInitialState(), true)
  seedDataStore({ prices: true })
})

async function chooseShip(user: ReturnType<typeof userEvent.setup>, query: string, option: string) {
  await user.type(screen.getByRole('combobox', { name: 'Ship' }), query)
  await user.click((await screen.findAllByRole('option', { name: new RegExp(option) }))[0])
}

describe('ShipView', () => {
  it('shows a loading state until static data is available', () => {
    useDataStore.setState({ staticData: null, staticStatus: 'loading' })
    render(<ShipView />)
    expect(screen.getByText(/Loading terminals/)).toBeInTheDocument()
  })

  it('shows a blocking error with Retry when nothing is cached', () => {
    useDataStore.setState({
      staticData: null,
      staticStatus: 'error',
      staticError: new UexError('network', 'offline'),
    })
    render(<ShipView />)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load data')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('selecting a ship sets free SCU and the max box size (criterion 4)', async () => {
    const user = userEvent.setup()
    render(<ShipView />)
    await chooseShip(user, 'cutlass bl', 'Drake Cutlass Black')
    expect(useAppStore.getState()).toMatchObject({ vehicleId: 100, freeScu: 46, maxBox: 16 })
    expect(screen.getByRole('combobox', { name: 'Ship' })).toHaveValue('Drake Cutlass Black')
    expect(screen.getByLabelText('Free cargo (SCU)')).toHaveValue('46')
    expect(screen.getByRole('radio', { name: '16' })).toHaveAttribute('aria-checked', 'true')
  })

  it('shows secondary info in the option line', async () => {
    const user = userEvent.setup()
    render(<ShipView />)
    await user.type(screen.getByRole('combobox', { name: 'Ship' }), 'cutlass black')
    expect(
      (await screen.findAllByRole('option', { name: /46 SCU · boxes ≤16/ }))[0],
    ).toBeInTheDocument()
  })

  it('hides concept ships unless toggled', async () => {
    const user = userEvent.setup()
    render(<ShipView />)
    await user.type(screen.getByRole('combobox', { name: 'Ship' }), 'kraken')
    expect(await screen.findByText('No ship matches')).toBeInTheDocument()
    await user.clear(screen.getByRole('combobox', { name: 'Ship' }))
    await user.click(screen.getByRole('checkbox', { name: 'Show concept ships' }))
    await user.type(screen.getByRole('combobox', { name: 'Ship' }), 'kraken')
    expect(await screen.findByRole('option', { name: /Drake Kraken/ })).toBeInTheDocument()
  })

  it('warns when the ship box sizes are unknown and preselects 32', async () => {
    const user = userEvent.setup()
    render(<ShipView />)
    await chooseShip(user, 'galaxy', 'RSI Galaxy')
    expect(screen.getByText(/Box sizes for this ship unknown/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '32' })).toHaveAttribute('aria-checked', 'true')
  })

  it('quick buttons set a percentage of the ship SCU', async () => {
    const user = userEvent.setup()
    render(<ShipView />)
    const group = screen.getByRole('group', { name: 'Quick cargo fill' })
    expect(within(group).getByRole('button', { name: '25 %' })).toBeDisabled()
    await chooseShip(user, 'cutlass bl', 'Drake Cutlass Black')
    await user.click(within(group).getByRole('button', { name: '50 %' }))
    expect(useAppStore.getState().freeScu).toBe(23)
    await user.click(within(group).getByRole('button', { name: '25 %' }))
    expect(useAppStore.getState().freeScu).toBe(11)
    await user.click(within(group).getByRole('button', { name: '100 %' }))
    expect(useAppStore.getState().freeScu).toBe(46)
  })

  it('steppers and typing clamp to 1…ship SCU', async () => {
    const user = userEvent.setup()
    render(<ShipView />)
    await chooseShip(user, 'cutlass bl', 'Drake Cutlass Black')
    await user.click(screen.getByRole('button', { name: 'Decrease Free cargo (SCU)' }))
    expect(useAppStore.getState().freeScu).toBe(45)
    expect(screen.getByRole('button', { name: 'Increase Free cargo (SCU)' })).toBeEnabled()
    const input = screen.getByLabelText('Free cargo (SCU)')
    await user.clear(input)
    await user.type(input, '999{Enter}')
    expect(useAppStore.getState().freeScu).toBe(46)
    await user.clear(input)
    await user.type(input, '0{Enter}')
    expect(useAppStore.getState().freeScu).toBe(1)
    expect(screen.getByRole('button', { name: 'Decrease Free cargo (SCU)' })).toBeDisabled()
  })

  it('changing the max box size updates the store immediately', async () => {
    const user = userEvent.setup()
    render(<ShipView />)
    await user.click(screen.getByRole('radio', { name: '4' }))
    expect(useAppStore.getState().maxBox).toBe(4)
  })

  it('has the filter toggles (illegal on, volatile off) and no stock/demand filters', async () => {
    const user = userEvent.setup()
    render(<ShipView />)
    expect(screen.getByRole('checkbox', { name: 'Include illegal commodities' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /quantum-volatile/ })).not.toBeChecked()
    expect(screen.queryByText(/stock|demand/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Include illegal commodities' }))
    await user.click(screen.getByRole('checkbox', { name: /quantum-volatile/ }))
    expect(useAppStore.getState()).toMatchObject({ includeIllegal: false, includeVolatileQt: true })
    await user.selectOptions(screen.getByLabelText('Max price age'), '7')
    expect(useAppStore.getState().maxPriceAgeDays).toBe(7)
    await user.selectOptions(screen.getByLabelText('Max price age'), 'Any age')
    expect(useAppStore.getState().maxPriceAgeDays).toBeNull()
  })

  it('shows the data attribution footer and data timestamps', () => {
    render(<ShipView />)
    expect(screen.getByText(/community-sourced, may be inaccurate/)).toBeInTheDocument()
    expect(screen.getByText(/^Prices:/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reload all data/ })).toBeEnabled()
    // prices were just fetched → refresh is cooling down
    expect(screen.getByRole('button', { name: /Refresh prices/ })).toBeDisabled()
  })
})
