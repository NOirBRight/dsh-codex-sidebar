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
import { decorate as decorateChips, sourceForFlowKey, type AnnotationChipPorts } from './annotation-chips.ts'
import { decorate as decorateStats } from './tool-stats.ts'
import { decorate as decoratePaths } from './path-links.ts'
import { createPendingThrottle, installTranscriptDecorators, shouldRebindSession } from './transcript-decorators.ts'
import { rowHunksFromSnapshot, sameRowHunks } from '../tool-open.ts'
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
    let lastSource: unknown
    let lastStats: ReturnType<typeof rowHunksFromSnapshot> = []
    const readStats = () => {
      const current = ctx.sessions.list.getSnapshot().current
      if (current === undefined) return []
      const binding = ctx.sessions.binding(current as never)
      if (binding === undefined) return []
      const source = binding.session.getSnapshot()
      if (source === lastSource) return lastStats
      lastSource = source
      const next = rowHunksFromSnapshot(source)
      if (sameRowHunks(next, lastStats)) return lastStats
      lastStats = next
      return lastStats
    }
    const chipPorts: AnnotationChipPorts = {
      sessionId: () => {
        const current = ctx.sessions.list.getSnapshot().current
        return current === undefined ? undefined : String(current)
      },
      nodeSource: (key: string) => {
        const current = ctx.sessions.list.getSnapshot().current
        if (current === undefined) return undefined
        const binding = ctx.sessions.binding(current as never)
        if (binding === undefined) return undefined
        return sourceForFlowKey(binding.session.getSnapshot(), key)
      },
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
        const open = ctx.workspaces?.openPath
        if (open !== undefined) void open(path)
      },
    })
    const throttle = createPendingThrottle(() => {
      const prev = lastStats
      readStats()
      decorators.paintData({ stats: lastStats !== prev, chips: true })
    }, 200)
    let unsubSession: (() => void) | undefined
    let boundId: string | undefined
    let boundStore: unknown
    const bindSession = (): void => {
      const current = ctx.sessions.list.getSnapshot().current
      const id = current === undefined ? undefined : String(current)
      const binding = current === undefined ? undefined : ctx.sessions.binding(current as never)
      const store = binding?.session
      if (!shouldRebindSession(boundId, boundStore, id, store)) return
      unsubSession?.()
      unsubSession = undefined
      throttle.cancel()
      lastSource = undefined
      lastStats = []
      boundId = id
      boundStore = store
      if (id === undefined || store === undefined) return
      unsubSession = store.subscribe(() => { throttle.schedule() })
      readStats()
      decorators.paintData()
    }
    bindSession()
    const stopList = ctx.sessions.list.subscribe(bindSession)
    return () => {
      decorators.stop()
      stopList()
      unsubSession?.()
      throttle.cancel()
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
