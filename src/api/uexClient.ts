export const BASE_URL = 'https://api.uexcorp.uk/2.0/'
export const REQUEST_TIMEOUT_MS = 15_000

export type UexErrorKind = 'network' | 'timeout' | 'aborted' | 'http' | 'api' | 'parse'

export class UexError extends Error {
  readonly kind: UexErrorKind
  readonly httpCode?: number

  constructor(kind: UexErrorKind, message: string, httpCode?: number) {
    super(message)
    this.name = 'UexError'
    this.kind = kind
    this.httpCode = httpCode
  }
}

interface Envelope {
  status?: unknown
  http_code?: unknown
  message?: unknown
  data?: unknown
}

function asEnvelope(value: unknown): Envelope | null {
  return typeof value === 'object' && value !== null ? value : null
}

/**
 * GET a UEX 2.0 endpoint (path relative to the base URL, may include a query string)
 * and return the envelope's `data`. Public endpoints: no API key, no custom headers.
 */
export async function uexGet(path: string, signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) throw new UexError('aborted', `Request to ${path} was aborted`)
  const url = new URL(path.replace(/^\//, ''), BASE_URL).toString()
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)
  const onExternalAbort = () => controller.abort()
  signal?.addEventListener('abort', onExternalAbort, { once: true })

  try {
    let response: Response
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })
    } catch (e) {
      if (timedOut) throw new UexError('timeout', `Request to ${path} timed out`)
      if (signal?.aborted) throw new UexError('aborted', `Request to ${path} was aborted`)
      throw new UexError('network', e instanceof Error ? e.message : 'Network error')
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      if (!response.ok) throw new UexError('http', `HTTP ${response.status}`, response.status)
      throw new UexError('parse', `Invalid JSON from ${path}`)
    }

    const envelope = asEnvelope(body)
    if (!response.ok) {
      const message = typeof envelope?.message === 'string' && envelope.message
      throw new UexError('http', message || `HTTP ${response.status}`, response.status)
    }
    if (!envelope) throw new UexError('parse', `Unexpected response from ${path}`)
    if (envelope.status !== 'ok') {
      const code = Number(envelope.http_code)
      const detail = typeof envelope.message === 'string' ? envelope.message : ''
      throw new UexError(
        'api',
        `${String(envelope.status)}${detail ? `: ${detail}` : ''}`,
        Number.isFinite(code) ? code : undefined,
      )
    }
    return envelope.data
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onExternalAbort)
  }
}

export const fetchCommodities = (signal?: AbortSignal) => uexGet('commodities', signal)
export const fetchTerminals = (signal?: AbortSignal) => uexGet('terminals?type=commodity', signal)
export const fetchVehicles = (signal?: AbortSignal) => uexGet('vehicles', signal)
export const fetchPricesAll = (signal?: AbortSignal) => uexGet('commodities_prices_all', signal)
export const fetchGameVersions = (signal?: AbortSignal) => uexGet('game_versions', signal)
