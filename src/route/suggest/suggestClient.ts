import { runSuggest, type SuggestJob, type WorkerRequest, type WorkerResponse } from './run'
import type { SuggestOutcome } from './types'

/** The part of a `Worker` the client uses (so tests can provide a fake). */
export interface WorkerLike {
  postMessage: (message: WorkerRequest) => void
  terminate: () => void
  addEventListener: {
    (type: 'message', listener: (event: MessageEvent<WorkerResponse>) => void): void
    (type: 'error', listener: () => void): void
  }
}

export interface SuggestClient {
  /**
   * Run one search. Resolves with `null` when a newer `run` superseded this one (only the
   * latest request is kept; a running stale search is cancelled by terminating its worker).
   */
  run: (job: SuggestJob) => Promise<SuggestOutcome | null>
  dispose: () => void
}

const FAILED: SuggestOutcome = { kind: 'unavailable', reason: 'The search failed.' }

/**
 * Client of the search worker (§6.7). Without a worker factory (no Worker support, tests) the
 * search runs inline in a microtask instead.
 */
export function createSuggestClient(createWorker: (() => WorkerLike) | null): SuggestClient {
  let worker: WorkerLike | null = null
  let nextId = 0
  let pending: { id: number; resolve: (outcome: SuggestOutcome | null) => void } | null = null

  const stop = () => {
    worker?.terminate()
    worker = null
  }

  const supersede = () => {
    if (!pending) return
    pending.resolve(null)
    pending = null
    stop() // the stale search keeps running otherwise and would delay the new one
  }

  return {
    run(job) {
      supersede()
      const id = ++nextId
      return new Promise<SuggestOutcome | null>((resolve) => {
        pending = { id, resolve }
        if (!createWorker) {
          void Promise.resolve().then(() => {
            if (pending?.id !== id) return
            pending = null
            try {
              resolve(runSuggest(job))
            } catch {
              resolve(FAILED)
            }
          })
          return
        }
        if (!worker) {
          worker = createWorker()
          worker.addEventListener('message', (event) => {
            if (pending?.id !== event.data.id) return
            pending.resolve(event.data.outcome)
            pending = null
          })
          worker.addEventListener('error', () => {
            pending?.resolve(FAILED)
            pending = null
            stop()
          })
        }
        worker.postMessage({ id, job })
      })
    },
    dispose() {
      supersede()
      stop()
    },
  }
}

let shared: SuggestClient | null = null

/** The app-wide client: a module Web Worker where supported, inline otherwise. */
export function getSuggestClient(): SuggestClient {
  shared ??= createSuggestClient(
    typeof Worker === 'undefined'
      ? null
      : () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
  )
  return shared
}

/** Test hook: replace (or reset with null) the app-wide client. */
export function setSuggestClient(client: SuggestClient | null): void {
  shared?.dispose()
  shared = client
}
