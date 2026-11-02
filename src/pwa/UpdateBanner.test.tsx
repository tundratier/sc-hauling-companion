import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UPDATE_CHECK_INTERVAL_MS, UpdateBanner } from './UpdateBanner'

const sw = vi.hoisted(() => ({
  needRefresh: false,
  updateServiceWorker: vi.fn<(reload?: boolean) => Promise<void>>(async () => {}),
  update: vi.fn<() => Promise<void>>(async () => {}),
}))

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options?: {
    onRegisteredSW?: (url: string, reg: ServiceWorkerRegistration) => void
  }) => {
    // like the real hook: the registration arrives once the worker is registered
    options?.onRegisteredSW?.('/sw.js', {
      update: sw.update,
    } as unknown as ServiceWorkerRegistration)
    return {
      needRefresh: [sw.needRefresh, () => {}],
      offlineReady: [false, () => {}],
      updateServiceWorker: sw.updateServiceWorker,
    }
  },
}))

const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  sw.needRefresh = false
  sw.updateServiceWorker.mockClear()
  sw.update.mockClear()
  sw.update.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
  setVisibility('visible')
})

describe('update banner', () => {
  it('is hidden while no new version waits', () => {
    render(<UpdateBanner />)
    expect(screen.queryByText('New version ready')).not.toBeInTheDocument()
  })

  it('shows when a version waits and RELOAD activates it and reloads', async () => {
    sw.needRefresh = true
    render(<UpdateBanner />)
    expect(screen.getByText('New version ready')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'RELOAD' }))
    expect(sw.updateServiceWorker).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('hides for this page session with the close button', async () => {
    sw.needRefresh = true
    render(<UpdateBanner />)
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('New version ready')).not.toBeInTheDocument()
  })
})

describe('update check', () => {
  const hours = (h: number) => h * UPDATE_CHECK_INTERVAL_MS

  it('runs when the page becomes visible, at most once per hour', () => {
    vi.useFakeTimers()
    render(<UpdateBanner />)

    // right after start-up the browser's own check counts
    act(() => setVisibility('visible'))
    expect(sw.update).not.toHaveBeenCalled()

    vi.advanceTimersByTime(hours(1))
    act(() => setVisibility('hidden'))
    expect(sw.update).not.toHaveBeenCalled()
    act(() => setVisibility('visible'))
    expect(sw.update).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(hours(1) - 1000)
    act(() => setVisibility('visible'))
    expect(sw.update).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1000)
    act(() => setVisibility('visible'))
    expect(sw.update).toHaveBeenCalledTimes(2)
  })

  it('ignores a failing check (offline)', async () => {
    vi.useFakeTimers()
    sw.update.mockRejectedValue(new TypeError('Failed to update a ServiceWorker'))
    render(<UpdateBanner />)
    vi.advanceTimersByTime(hours(2))
    act(() => setVisibility('visible'))
    await vi.advanceTimersByTimeAsync(0)
    expect(sw.update).toHaveBeenCalledTimes(1)
  })
})
