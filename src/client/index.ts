/** Browser half: 侧栏 occupies details; 侧栏开关 hangs off the 主会话 header. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import { SidebarController } from './controller.ts'
import { ensureSidebarStyles } from './css.ts'
import { en, NS, zh, type SidebarKey } from './locales.ts'
import { SidebarPanel, type SidebarFace } from './Sidebar.tsx'
import { SidebarToggle, type ToggleFace } from './Toggle.tsx'
import { AttachmentChips } from './AttachmentChips.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'codex-sidebar': SidebarKey
  }
}

export const name = 'dsh-codex-sidebar-client'
export const inject = ['slots', 'locale', 'connection', 'layout', 'sessions', 'workspaces']

export function apply(ctx: ClientContext): void {
  ensureSidebarStyles()
  const controller = new SidebarController(ctx)
  controller.installPathTakeover()
  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    'dsh-codex-sidebar: chrome copy',
  )

  const face = (): SidebarFace & ToggleFace => ({
    hooks: { sidebar: controller },
    controller,
  })

  ctx.slots.inject('details', () => ctx.slots.register({
    name: 'details',
    locale: NS,
    inject: face,
  }, SidebarPanel))

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'codex-sidebar-toggle',
    order: 80,
    locale: NS,
    inject: face,
  }, SidebarToggle))

  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'codex-sidebar-attachments',
    order: 5,
    locale: NS,
    inject: face,
  }, AttachmentChips))
}
