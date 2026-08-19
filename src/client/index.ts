/** Browser half: 3-column squeeze; 侧栏 occupies the details track. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import { SidebarController } from './controller.ts'
import { ensureSidebarStyles } from './css.ts'
import { en, NS, zh, type SidebarKey } from './locales.ts'
import { SidebarPanel, type SidebarFace } from './Sidebar.tsx'
import { AttachmentChips } from './AttachmentChips.tsx'
import { NarrowDrawer } from './NarrowDrawer.tsx'
import { installAnnotationChips, sourceForFlowKey } from './annotation-chips.ts'
import { installToolStats } from './tool-stats.ts'
import { rowStatsFromSnapshot } from '../tool-open.ts'
import { CLIENT_INJECT, occupyDetails } from '../details-occupancy.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'codex-sidebar': SidebarKey
  }
}

export const name = 'dsh-codex-sidebar-client'
export const inject = [...CLIENT_INJECT]

export function apply(ctx: ClientContext): void {
  ctx.locale.register(NS, { zh, en })
  ensureSidebarStyles()
  const controller = new SidebarController(ctx)
  const face = (): SidebarFace => ({
    hooks: { sidebar: controller },
    controller,
  })
  occupyDetails(ctx.slots, face, SidebarPanel, NS)
  try {
    controller.installPathTakeover()
  } catch (err) {
    console.error('[dsh-codex-sidebar] path takeover skipped', err)
  }
  ctx.effect(() => {
    const readStats = () => {
      const current = ctx.sessions.list.getSnapshot().current
      if (current === undefined) return []
      const binding = ctx.sessions.binding(current as never)
      if (binding === undefined) return []
      return rowStatsFromSnapshot(binding.session.getSnapshot())
    }
    const hook = installToolStats(readStats)
    const chips = installAnnotationChips({
      sessionId: () => {
        const current = ctx.sessions.list.getSnapshot().current
        return current === undefined ? undefined : String(current)
      },
      nodeSource: (key) => {
        const current = ctx.sessions.list.getSnapshot().current
        if (current === undefined) return undefined
        const binding = ctx.sessions.binding(current as never)
        if (binding === undefined) return undefined
        return sourceForFlowKey(binding.session.getSnapshot(), key)
      },
      reveal: (sessionId, mark) => {
        void controller.dispatch(sessionId, { type: 'reveal-mark', mark })
      },
      label: (n, from) => en.openMark.replace('{n}', String(n)).replace('{from}', from),
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    let unsubSession: (() => void) | undefined
    const paint = (): void => {
      hook.paint()
      chips.paint()
    }
    const bindSession = (): void => {
      unsubSession?.()
      unsubSession = undefined
      const current = ctx.sessions.list.getSnapshot().current
      if (current === undefined) return
      const binding = ctx.sessions.binding(current as never)
      if (binding === undefined) return
      unsubSession = binding.session.subscribe(() => {
        if (timer !== undefined) clearTimeout(timer)
        timer = setTimeout(paint, 200)
      })
      paint()
    }
    bindSession()
    const stopList = ctx.sessions.list.subscribe(bindSession)
    const stopStore = controller.subscribe(paint)
    return () => {
      hook.stop()
      chips.stop()
      stopList()
      stopStore()
      unsubSession?.()
      if (timer !== undefined) clearTimeout(timer)
    }
  }, 'dsh-codex-sidebar: edit +/− and 批注 chips')
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'codex-sidebar-attachments',
    order: 5,
    locale: NS,
    inject: face,
  }, AttachmentChips))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'codex-sidebar-drawer',
    locale: NS,
    inject: face,
  }, NarrowDrawer))
}
