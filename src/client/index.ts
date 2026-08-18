/** Browser half: 3-column squeeze; 侧栏 occupies the details track. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import { SidebarController } from './controller.ts'
import { ensureSidebarStyles } from './css.ts'
import { en, NS, zh, type SidebarKey } from './locales.ts'
import { SidebarPanel, type SidebarFace } from './Sidebar.tsx'
import { SidebarToggle } from './Toggle.tsx'
import { AttachmentChips } from './AttachmentChips.tsx'
import { NarrowDrawer } from './NarrowDrawer.tsx'
import { installToolStats } from './tool-stats.ts'
import { statsFromSnapshot } from '../tool-open.ts'
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
    const readStats = (): Record<string, { added: number; removed: number }> => {
      const current = ctx.sessions.list.getSnapshot().current
      if (current === undefined) return {}
      const host = controller.snap(String(current))?.fileStats ?? {}
      const binding = ctx.sessions.binding(current as never)
      const live = binding === undefined ? {} : statsFromSnapshot(binding.session.getSnapshot())
      return { ...host, ...live }
    }
    const hook = installToolStats(readStats)
    let timer: ReturnType<typeof setTimeout> | undefined
    let unsubSession: (() => void) | undefined
    const bindSession = (): void => {
      unsubSession?.()
      unsubSession = undefined
      const current = ctx.sessions.list.getSnapshot().current
      if (current === undefined) return
      const binding = ctx.sessions.binding(current as never)
      if (binding === undefined) return
      unsubSession = binding.session.subscribe(() => {
        if (timer !== undefined) clearTimeout(timer)
        timer = setTimeout(hook.paint, 200)
      })
    }
    bindSession()
    const stopList = ctx.sessions.list.subscribe(bindSession)
    const stopStore = controller.subscribe(hook.paint)
    return () => {
      hook.stop()
      stopList()
      stopStore()
      unsubSession?.()
      if (timer !== undefined) clearTimeout(timer)
    }
  }, 'dsh-codex-sidebar: edit +/− on tool rows')
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'codex-sidebar-toggle',
    order: 80,
    locale: NS,
    inject: face,
  }, SidebarToggle))

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
