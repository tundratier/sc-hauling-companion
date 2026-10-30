import { describe, expect, it } from 'vitest'
import { testMap } from '../../test-utils/mapFixture'
import { commodity, buyOffer, sellOffer, terminal } from '../../test-utils/calcFixtures'
import { DEFAULT_CALC_OPTIONS } from '../../calc'
import type { SuggestJob, WorkerRequest, WorkerResponse } from './run'
import { createSuggestClient, type SuggestClient, type WorkerLike } from './suggestClient'
import { DEFAULT_SUGGEST_OPTIONS, type SuggestOutcome } from './types'

const job = (fixed: number[] = [1, 2]): SuggestJob => ({
  request: {
    fixed,
    calc: {
      freeScu: 10,
      shipBoxSizes: null,
      boxRange: { min: 1, max: 32 },
      smallHangar: false,
      options: DEFAULT_CALC_OPTIONS,
    },
    options: { ...DEFAULT_SUGGEST_OPTIONS, enabled: true },
    dismissed: [],
    nowSec: 1_800_000_000,
  },
  terminals: [1, 2, 3].map((id) => terminal(id)),
  commodities: [commodity(1, { name: 'Quartz' })],
  offers: [buyOffer(1, 3, 100), sellOffer(1, 2, 150)],
  map: testMap([
    { id: 'station:A', x: 0, terminals: [1] },
    { id: 'station:X', x: 50, terminals: [3] },
    { id: 'station:B', x: 100, terminals: [2] },
  ]),
})

class FakeWorker implements WorkerLike {
  posted: WorkerRequest[] = []
  terminated = false
  private message: ((e: MessageEvent<WorkerResponse>) => void)[] = []
  private error: ((e: MessageEvent<WorkerResponse>) => void)[] = []
  postMessage = (m: WorkerRequest) => {
    this.posted.push(m)
  }
  terminate = () => {
    this.terminated = true
  }
  addEventListener(type: 'message', listener: (e: MessageEvent<WorkerResponse>) => void): void
  addEventListener(type: 'error', listener: () => void): void
  addEventListener(type: string, listener: (e: MessageEvent<WorkerResponse>) => void): void {
    if (type === 'message') this.message.push(listener)
    else this.error.push(listener)
  }
  reply(id: number, outcome: SuggestOutcome) {
    for (const l of this.message) l(new MessageEvent('message', { data: { id, outcome } }))
  }
  fail() {
    for (const l of this.error) l(new MessageEvent('error'))
  }
}

describe('inline fallback (no Worker support)', () => {
  it('runs the search and resolves with the outcome', async () => {
    const client = createSuggestClient(null)
    const outcome = await client.run(job())
    expect(outcome?.kind).toBe('ok')
    client.dispose()
  })

  it('resolves a superseded request with null and only answers the latest one', async () => {
    const client = createSuggestClient(null)
    const first = client.run(job([1]))
    const second = client.run(job())
    expect(await first).toBeNull()
    expect((await second)?.kind).toBe('ok')
  })

  it('reports a failed search instead of throwing', async () => {
    const client = createSuggestClient(null)
    const broken = { ...job(), map: { ...job().map, nodes: [], travel: [] } }
    const outcome = await client.run({ ...broken, terminals: [] })
    expect(outcome?.kind).toBeDefined()
  })
})

describe('worker client', () => {
  const setup = () => {
    const workers: FakeWorker[] = []
    const client: SuggestClient = createSuggestClient(() => {
      const w = new FakeWorker()
      workers.push(w)
      return w
    })
    return { client, workers }
  }

  it('posts the job with an id and resolves with the matching response', async () => {
    const { client, workers } = setup()
    const promise = client.run(job())
    expect(workers).toHaveLength(1)
    const [{ id, job: sent }] = workers[0].posted
    expect(sent.request.fixed).toEqual([1, 2])
    workers[0].reply(id, { kind: 'none', bestFound: false })
    expect(await promise).toEqual({ kind: 'none', bestFound: false })
  })

  it('cancels a stale search by terminating its worker and keeps only the latest request', async () => {
    const { client, workers } = setup()
    const first = client.run(job([1]))
    const second = client.run(job())
    expect(await first).toBeNull()
    expect(workers[0].terminated).toBe(true)
    expect(workers).toHaveLength(2)
    const [{ id }] = workers[1].posted
    workers[1].reply(id, { kind: 'none', bestFound: true })
    expect(await second).toEqual({ kind: 'none', bestFound: true })
  })

  it('ignores a response for a request that was superseded', async () => {
    const { client, workers } = setup()
    const first = client.run(job())
    const staleId = workers[0].posted[0].id
    const second = client.run(job())
    workers[0].reply(staleId, { kind: 'none', bestFound: false }) // arrives late
    workers[1].reply(workers[1].posted[0].id, { kind: 'none', bestFound: true })
    expect(await first).toBeNull()
    expect(await second).toEqual({ kind: 'none', bestFound: true })
  })

  it('reuses the worker between sequential requests', async () => {
    const { client, workers } = setup()
    const a = client.run(job())
    workers[0].reply(workers[0].posted[0].id, { kind: 'none', bestFound: false })
    await a
    const b = client.run(job())
    expect(workers).toHaveLength(1)
    workers[0].reply(workers[0].posted[1].id, { kind: 'none', bestFound: false })
    await b
  })

  it('reports a crashed worker and starts a fresh one next time', async () => {
    const { client, workers } = setup()
    const promise = client.run(job())
    workers[0].fail()
    expect(await promise).toEqual({ kind: 'unavailable', reason: 'The search failed.' })
    expect(workers[0].terminated).toBe(true)
    void client.run(job())
    expect(workers).toHaveLength(2)
  })

  it('disposes the worker', () => {
    const { client, workers } = setup()
    void client.run(job())
    client.dispose()
    expect(workers[0].terminated).toBe(true)
  })
})
