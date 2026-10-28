import type { Terminal } from '../domain/types'

/** Short terminal name for route summaries and option lines: nickname, then displayname. */
export const shortName = (terminal: Terminal | undefined, id?: number): string =>
  terminal?.nickname || terminal?.displayname || `#${id ?? '?'}`
