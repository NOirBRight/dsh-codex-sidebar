/** Review 工具 slice. Ticket 02 owns this file. */

import type { Effect } from './session.ts'

export type ReviewIntent = never

export type ReviewPort = Record<string, never>

export type ReviewState = {
  mode: 'turn' | 'tree'
}

export function emptyReview(): ReviewState {
  return { mode: 'turn' }
}

export function projectReview(state: ReviewState, _port?: ReviewPort): ReviewState {
  return { ...state }
}

export function reduceReview(
  _state: ReviewState,
  _intent: { type: string },
  _port?: ReviewPort,
): { state: ReviewState; effects: Effect[] } | undefined {
  return undefined
}
