/** Review 工具 slice. Ticket 02 owns this file. */

import type { Effect } from './session.ts'

export type ReviewIntent = never

export type ReviewState = {
  mode: 'turn' | 'tree'
}

export function emptyReview(): ReviewState {
  return { mode: 'turn' }
}

export function reduceReview(_state: ReviewState, _intent: { type: string }): { state: ReviewState; effects: Effect[] } | undefined {
  return undefined
}
