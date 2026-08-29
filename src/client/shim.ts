/** Official types only. `dsh-client-runtime` was removed in DSH 0.1.2-alpha.1. */
import type { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'

type SlotService = SlotCore & {
  inject(key: string, callback: () => unknown): unknown
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Slot registry provided by Alpha1 ui-slots. */
    slots: SlotService
  }
}

export type { Context as ClientContext } from '@deepseek-ai/cordis'
export type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
