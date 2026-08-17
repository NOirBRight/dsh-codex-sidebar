/** Side Chat 工具 slice. Ticket 05 owns this file. */

import type { Effect } from './session.ts'

export type SideChatIntent = never

export type SideChatPort = Record<string, never>

export type SideChatState = {
  forked: boolean
}

export function emptySideChat(): SideChatState {
  return { forked: false }
}

export function projectSideChat(state: SideChatState, _port?: SideChatPort): SideChatState {
  return { ...state }
}

export function reduceSideChat(
  _state: SideChatState,
  _intent: { type: string },
  _port?: SideChatPort,
): { state: SideChatState; effects: Effect[] } | undefined {
  return undefined
}
