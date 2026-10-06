import type { Round } from '../types'

// Rounds as kept in session state. Earlier versions kept bare paths, and
// state outlives a reload, so a string reads as one round.
export const roundsOf = (list: readonly unknown[]): Round[] =>
  list.flatMap(r =>
    typeof r === 'string'
      ? [{ path: r, rounds: 1 }]
      : r && typeof r === 'object' && typeof (r as Round).path === 'string'
        ? [{ path: (r as Round).path, rounds: Number((r as Round).rounds) || 1 }]
        : [],
  )
