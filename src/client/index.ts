/** Browser half: 3-column squeeze; 侧栏 occupies the details track. */

import type { ClientContext } from './shim.js'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
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
import { decorate as decorateChips, type AnnotationChipPorts } from './annotation-chips.ts'
import { decorate as decorateStats } from './tool-stats.ts'
import { decorate as decoratePaths } from './path-links.ts'
import { createPendingThrottle, installTranscriptDecorators, shouldRebindSession } from './transcript-decorators.ts'
import { sameRowHunks, type RowHunkStat } from '../tool-open.ts'
import { createConversationProjection, type ConversationProjection } from './conversation-projection.ts'
import type { Annotation } from '../session.ts'
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
  ctx.effect(() => () => { controller.dispose() }, 'dsh-codex-sidebar: controller lifecycle')
  const face = (): SidebarFace => ({
    hooks: { sidebar: controller },
    controller,
  })
  occupyDetails(ctx.slots, face, SidebarPanel, NS)
  ctx.effect(() => {
    controller.installRuntimeIntegration()
    return () => { controller.uninstallIntegration() }
  }, 'dsh-codex-sidebar: Alpha.4 runtime integration adapter')
  ctx.effect(() => {
    let conversationProjection: ConversationProjection | undefined
    let lastStats: readonly RowHunkStat[] = []
    const readStats = () => {
      const next = conversationProjection?.rowHunks() ?? []
      if (sameRowHunks(next, lastStats)) return lastStats
      lastStats = next
      return lastStats
    }
    const chipPorts: AnnotationChipPorts = {
      sessionId: () => {
        const current = ctx.sessions.list.getSnapshot().current
        return current === undefined ? undefined : String(current)
      },
      nodeSource: (key: string) => conversationProjection?.sourceForFlowKey(key),
      reveal: (sessionId: string, mark: Annotation) => {
        void controller.dispatch(sessionId, { type: 'reveal-mark', mark })
      },
      label: (n: number, from: string) => en.openMark.replace('{n}', String(n)).replace('{from}', from),
    }
    const decorators = installTranscriptDecorators({
      paintStats: (root) => { decorateStats(lastStats, root) },
      paintChips: (root) => { decorateChips(chipPorts, root) },
      paintPaths: (root) => { decoratePaths(root) },
      openPath: (path) => {
        const takeover = controller.openTranscriptPath(path)
        if (takeover !== undefined) return takeover
        const open = (ctx.workspaces as typeof ctx.workspaces & { openPath?: (path: string) => void | Promise<void> }).openPath
        if (typeof open !== 'function') return false
        return Promise.resolve(open(path)).then(() => false)
      },
    })
    const throttle = createPendingThrottle(() => {
      const prev = lastStats
      readStats()
      decorators.paintData({ stats: lastStats !== prev, chips: true })
    }, 200)
    let unsubStats: (() => void) | undefined
    let boundId: string | undefined
    let boundBinding: unknown
    const bindSession = (): void => {
      const current = ctx.sessions.list.getSnapshot().current
      const id = current === undefined ? undefined : String(current)
      const binding = current === undefined ? undefined : ctx.sessions.binding(current as never)
      if (!shouldRebindSession(boundId, boundBinding, id, binding)) return
      unsubStats?.()
      unsubStats = undefined
      throttle.cancel()
      lastStats = []
      boundId = id
      boundBinding = binding
      conversationProjection = binding === undefined ? undefined : createConversationProjection(ctx, binding)
      if (id === undefined || conversationProjection === undefined) return
      unsubStats = conversationProjection.subscribe(() => { throttle.schedule() })
      readStats()
      decorators.paintData()
    }
    bindSession()
    const stopList = ctx.sessions.list.subscribe(bindSession)
    return () => {
      const failures: unknown[] = []
      try { decorators.stop() } catch (error) { failures.push(error) }
      try { stopList() } catch (error) { failures.push(error) }
      try { unsubStats?.() } catch (error) { failures.push(error) }
      try { throttle.cancel() } catch (error) { failures.push(error) }
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1) throw new AggregateError(failures, 'transcript decorator disposal failed')
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
