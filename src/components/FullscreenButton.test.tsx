import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  enterFullscreen,
  exitFullscreen,
  isFullscreen,
  isFullscreenSupported,
} from '../lib/fullscreen'
import { Header } from './Header'
import { FullscreenButton } from './FullscreenButton'

/** Minimal mocked Fullscreen API on `document` (jsdom has none). */
function mockApi(opts: { prefix?: '' | 'webkit'; reject?: boolean } = {}) {
  const prefix = opts.prefix ?? ''
  let element: Element | null = null
  const enabledKey = prefix ? 'webkitFullscreenEnabled' : 'fullscreenEnabled'
  const elementKey = prefix ? 'webkitFullscreenElement' : 'fullscreenElement'
  const eventName = prefix ? 'webkitfullscreenchange' : 'fullscreenchange'
  const requestKey = prefix ? 'webkitRequestFullscreen' : 'requestFullscreen'
  const exitKey = prefix ? 'webkitExitFullscreen' : 'exitFullscreen'
  const change = (el: Element | null) => {
    element = el
    document.dispatchEvent(new Event(eventName))
  }
  const request = vi.fn<(options?: FullscreenOptions) => Promise<void>>(async () => {
    if (opts.reject) throw new TypeError('Permissions check failed')
    change(document.documentElement)
  })
  const exit = vi.fn<() => Promise<void>>(async () => change(null))
  const defs: [object, string, PropertyDescriptor][] = [
    [document, enabledKey, { configurable: true, get: () => true }],
    [document, elementKey, { configurable: true, get: () => element }],
    [document, exitKey, { configurable: true, value: exit }],
    [document.documentElement, requestKey, { configurable: true, value: request }],
  ]
  for (const [target, key, desc] of defs) Object.defineProperty(target, key, desc)
  return {
    request,
    exit,
    /** Esc or a system gesture: leaves full screen without the app being asked. */
    leaveExternally: () => change(null),
    restore: () => {
      for (const [target, key] of defs) Reflect.deleteProperty(target, key)
    },
  }
}

let api: ReturnType<typeof mockApi> | null = null

beforeEach(() => {
  api = null
})
afterEach(() => api?.restore())

describe('FullscreenButton with a supported Fullscreen API', () => {
  it('shows an icon button labelled "Enter full screen" (aria-pressed false)', () => {
    api = mockApi()
    render(<FullscreenButton />)
    const button = screen.getByRole('button', { name: 'Enter full screen' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(button).toHaveAttribute('title', 'Enter full screen')
    expect(button.querySelector('svg')).toBeInTheDocument()
    expect(button).toHaveClass('btn--icon')
  })

  it('enters full screen with navigationUI hidden and flips label, title, icon and pressed state', async () => {
    api = mockApi()
    const user = userEvent.setup()
    render(<FullscreenButton />)
    const before = screen.getByRole('button').innerHTML
    await user.click(screen.getByRole('button'))
    expect(api.request).toHaveBeenCalledWith({ navigationUI: 'hide' })
    const button = screen.getByRole('button', { name: 'Exit full screen' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toHaveAttribute('title', 'Exit full screen')
    expect(button.innerHTML).not.toBe(before) // collapse icon instead of expand
  })

  it('leaves full screen again with the button', async () => {
    api = mockApi()
    const user = userEvent.setup()
    render(<FullscreenButton />)
    await user.click(screen.getByRole('button'))
    await user.click(screen.getByRole('button', { name: 'Exit full screen' }))
    expect(api.exit).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Enter full screen' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('follows the real state when full screen is left with Esc or a system gesture', async () => {
    api = mockApi()
    const user = userEvent.setup()
    render(<FullscreenButton />)
    await user.click(screen.getByRole('button'))
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toBeInTheDocument()
    act(() => api?.leaveExternally())
    expect(screen.getByRole('button', { name: 'Enter full screen' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(api.exit).not.toHaveBeenCalled()
  })

  it('stays windowed and silent when the request is rejected', async () => {
    api = mockApi({ reject: true })
    const user = userEvent.setup()
    render(<FullscreenButton />)
    await user.click(screen.getByRole('button'))
    expect(api.request).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Enter full screen' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('works with the webkit-prefixed API (older iPadOS Safari)', async () => {
    api = mockApi({ prefix: 'webkit' })
    const user = userEvent.setup()
    render(<FullscreenButton />)
    await user.click(screen.getByRole('button', { name: 'Enter full screen' }))
    expect(api.request).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toBeInTheDocument()
    await user.click(screen.getByRole('button'))
    expect(api.exit).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Enter full screen' })).toBeInTheDocument()
  })

  it('stops listening when unmounted', () => {
    api = mockApi()
    const remove = vi.spyOn(document, 'removeEventListener')
    const { unmount } = render(<FullscreenButton />)
    unmount()
    expect(remove).toHaveBeenCalledWith('fullscreenchange', expect.any(Function))
    expect(remove).toHaveBeenCalledWith('webkitfullscreenchange', expect.any(Function))
    remove.mockRestore()
  })
})

describe('without a Fullscreen API (e.g. iPhone Safari)', () => {
  it('renders nothing', () => {
    const { container } = render(<FullscreenButton />)
    expect(container).toBeEmptyDOMElement()
    expect(isFullscreenSupported()).toBe(false)
  })

  it('does not render when the API exists but is disabled', () => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => false })
    const { container } = render(<FullscreenButton />)
    expect(container).toBeEmptyDOMElement()
    Reflect.deleteProperty(document, 'fullscreenEnabled')
  })

  it('helpers resolve to false instead of throwing', async () => {
    expect(isFullscreen()).toBe(false)
    expect(await enterFullscreen()).toBe(false)
    expect(await exitFullscreen()).toBe(false)
  })
})

describe('in the header', () => {
  it('is the rightmost header control, after refresh', () => {
    api = mockApi()
    render(<Header status="PRICES 1m · LIVE 4.10.2" onRefresh={() => {}} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Refresh prices',
      'Enter full screen',
    ])
  })

  it('leaves the header without the button when unsupported', () => {
    render(<Header status="PRICES 1m · LIVE 4.10.2" onRefresh={() => {}} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })
})
