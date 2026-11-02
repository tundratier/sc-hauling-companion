import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InstallButton } from './InstallButton'
import { initInstallPrompt } from './installPrompt'

let cleanup: () => void

const mockStandalone = (standalone: boolean) =>
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: standalone && query.includes('standalone') })),
  )

/** A Chromium-style install event with a spy-able prompt(). */
function installEvent() {
  const prompt = vi.fn<() => Promise<void>>(async () => {})
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt })
  return { event, prompt }
}

beforeEach(() => {
  mockStandalone(false)
  cleanup = initInstallPrompt()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('INSTALL APP button', () => {
  it('is absent until the browser fires beforeinstallprompt', () => {
    render(<InstallButton />)
    expect(screen.queryByRole('button', { name: 'INSTALL APP' })).not.toBeInTheDocument()
  })

  it('shows after the event, keeps the browser prompt back and calls prompt() on tap', async () => {
    render(<InstallButton />)
    const { event, prompt } = installEvent()
    act(() => {
      window.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'INSTALL APP' }))
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it('goes away after the prompt, whatever the outcome', async () => {
    render(<InstallButton />)
    const { event, prompt } = installEvent()
    prompt.mockRejectedValue(new Error('dismissed'))
    act(() => {
      window.dispatchEvent(event)
    })
    await userEvent.click(screen.getByRole('button', { name: 'INSTALL APP' }))
    expect(screen.queryByRole('button', { name: 'INSTALL APP' })).not.toBeInTheDocument()
  })

  it('goes away on appinstalled', () => {
    render(<InstallButton />)
    act(() => {
      window.dispatchEvent(installEvent().event)
    })
    expect(screen.getByRole('button', { name: 'INSTALL APP' })).toBeInTheDocument()
    act(() => {
      window.dispatchEvent(new Event('appinstalled'))
    })
    expect(screen.queryByRole('button', { name: 'INSTALL APP' })).not.toBeInTheDocument()
  })

  it('is never rendered in display-mode: standalone', () => {
    mockStandalone(true)
    render(<InstallButton />)
    act(() => {
      window.dispatchEvent(installEvent().event)
    })
    expect(screen.queryByRole('button', { name: 'INSTALL APP' })).not.toBeInTheDocument()
  })
})
