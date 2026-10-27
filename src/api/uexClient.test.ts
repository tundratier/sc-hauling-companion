import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installMockFetch, json } from '../test-utils/mockFetch'
import { REQUEST_TIMEOUT_MS, UexError, fetchTerminals, uexGet } from './uexClient'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('uexGet', () => {
  it('returns the envelope data and sends no custom headers beyond Accept', async () => {
    const mock = installMockFetch((url) =>
      url.pathname === '/2.0/x' ? json({ status: 'ok', http_code: 200, data: [1, 2] }) : undefined,
    )
    await expect(uexGet('x')).resolves.toEqual([1, 2])
    const [url, init] = mock.mock.calls[0]
    expect(String(url)).toBe('https://api.uexcorp.uk/2.0/x')
    expect(init?.headers).toEqual({ Accept: 'application/json' })
  })

  it('keeps query strings', async () => {
    const mock = installMockFetch()
    await fetchTerminals()
    expect(String(mock.mock.calls[0][0])).toBe(
      'https://api.uexcorp.uk/2.0/terminals?type=commodity',
    )
  })

  it('throws an api error for status !== "ok"', async () => {
    installMockFetch(() =>
      json({ status: 'requests_limit_reached', http_code: 429, message: 'slow down', data: null }),
    )
    await expect(uexGet('x')).rejects.toMatchObject({
      name: 'UexError',
      kind: 'api',
      httpCode: 429,
      message: 'requests_limit_reached: slow down',
    })
  })

  it('throws an http error for non-2xx responses', async () => {
    installMockFetch(() => json({ message: 'boom' }, 500))
    await expect(uexGet('x')).rejects.toMatchObject({
      kind: 'http',
      httpCode: 500,
      message: 'boom',
    })
  })

  it('throws an http error for non-JSON error bodies', async () => {
    installMockFetch(() => new Response('<html>', { status: 502 }))
    await expect(uexGet('x')).rejects.toMatchObject({ kind: 'http', httpCode: 502 })
  })

  it('throws a parse error for invalid JSON or a non-object body', async () => {
    installMockFetch(() => new Response('nope', { status: 200 }))
    await expect(uexGet('x')).rejects.toMatchObject({ kind: 'parse' })
    installMockFetch(() => json([1, 2, 3]))
    await expect(uexGet('x')).rejects.toMatchObject({ kind: 'api' })
    installMockFetch(() => json(null))
    await expect(uexGet('x')).rejects.toMatchObject({ kind: 'parse' })
  })

  it('throws a network error when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const error = await uexGet('x').catch((e) => e)
    expect(error).toBeInstanceOf(UexError)
    expect(error).toMatchObject({ kind: 'network', message: 'Failed to fetch' })
  })

  describe('abort and timeout', () => {
    beforeEach(() => {
      // fetch that never resolves but honours the abort signal
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url: unknown, init?: RequestInit) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () =>
                reject(new DOMException('aborted', 'AbortError')),
              )
            }),
        ),
      )
    })

    it('times out after 15 s', async () => {
      vi.useFakeTimers()
      const promise = uexGet('x')
      const assertion = expect(promise).rejects.toMatchObject({ kind: 'timeout' })
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)
      await assertion
    })

    it('honours an external AbortSignal', async () => {
      const controller = new AbortController()
      const promise = uexGet('x', controller.signal)
      controller.abort()
      await expect(promise).rejects.toMatchObject({ kind: 'aborted' })
    })

    it('rejects immediately when the signal is already aborted', async () => {
      await expect(uexGet('x', AbortSignal.abort())).rejects.toMatchObject({ kind: 'aborted' })
    })
  })
})
