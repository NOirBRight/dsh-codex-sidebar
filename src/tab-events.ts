import type { Intent } from './session.ts'

export function tabAuxIntent(button: number, tabId: string): Intent | undefined {
  if (button !== 1) return undefined
  return { type: 'close-tab', id: tabId }
}
