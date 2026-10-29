// Web Worker entry of the profitable-stops search (SPEC §6.7): keeps the exact search off the
/// main thread. One request at a time; the client terminates the worker to cancel a stale one.
import { runSuggest, type WorkerRequest, type WorkerResponse } from './run'

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const { id, job } = event.data
  const response: WorkerResponse = { id, outcome: runSuggest(job) }
  self.postMessage(response)
})
