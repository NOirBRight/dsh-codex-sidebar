/** Review 工具 slice. Ticket 02 owns this file. */

export type ReviewIntent = never

export type ReviewState = {
  mode: 'turn' | 'tree'
}

export function emptyReview(): ReviewState {
  return { mode: 'turn' }
}

export function reduceReview(_state: ReviewState, _intent: { type: string }): ReviewState | undefined {
  return undefined
}
