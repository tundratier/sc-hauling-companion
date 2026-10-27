import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { STORAGE_KEY, useAppStore } from './state/useAppStore'

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState({ tab: 'ship' })
})

describe('App shell', () => {
  it('renders the app name and the three views as bottom tabs', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { level: 1, name: /hauling companion/i }),
    ).toBeInTheDocument()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Ship', 'Route', 'Trades'])
    expect(screen.getByRole('tab', { name: 'Ship' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: 'Ship' })).toBeInTheDocument()
  })

  it('switches views by tab and persists the selected tab', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('tab', { name: 'Route' }))
    expect(screen.getByRole('tab', { name: 'Route' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: 'Route' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).state.tab).toBe('route')
  })

  it('supports arrow-key navigation between tabs', async () => {
    const user = userEvent.setup()
    render(<App />)
    screen.getByRole('tab', { name: 'Ship' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Route' })).toHaveFocus()
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Trades' })).toHaveFocus()
    expect(screen.getByRole('heading', { name: 'Trades' })).toBeInTheDocument()
  })

  it('shows the data attribution in the SHIP view', () => {
    render(<App />)
    expect(screen.getByText(/Data: UEX Corp/)).toBeInTheDocument()
    expect(screen.getByText(/Not affiliated with Cloud Imperium Games/)).toBeInTheDocument()
  })
})
