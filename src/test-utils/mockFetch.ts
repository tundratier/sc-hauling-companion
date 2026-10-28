import { vi, type Mock } from 'vitest'
import commodities from '../__fixtures__/commodities.json'
import gameVersions from '../__fixtures__/gameVersions.json'
import pricesAll from '../__fixtures__/pricesAll.json'
import terminals from '../__fixtures__/terminals.json'
import vehicles from '../__fixtures__/vehicles.json'

export const urlOf = (input: Parameters<typeof fetch>[0]): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

const bodies: Record<string, unknown> = {
  '/2.0/commodities': commodities,
  '/2.0/terminals': terminals,
  '/2.0/vehicles': vehicles,
  '/2.0/game_versions': gameVersions,
  '/2.0/commodities_prices_all': pricesAll,
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/** Replace global `fetch` with a router over the fixtures. Returns the mock. */
export function installMockFetch(
  override?: (url: URL) => Response | Promise<Response> | undefined,
): Mock<typeof fetch> {
  const mock = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(urlOf(input))
    const custom = await override?.(url)
    if (custom) return custom
    const body = bodies[url.pathname]
    return body ? json(body) : json({ status: 'error', http_code: 404, message: 'unknown' }, 404)
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

export const requestedPaths = (mock: Mock<typeof fetch>) =>
  mock.mock.calls.map(([input]) => new URL(urlOf(input)).pathname.replace('/2.0/', ''))
