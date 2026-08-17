/** Host SideChatPort: live cwd read/search; log / 列出 / 投递 from the RPC gate. */

import type { FilesPort } from './session.ts'
import type { SearchHit, SideChatPort, SourcedDelivery } from './side-chat.ts'
import type { SessionIo } from './registry.ts'

export function createHostSideChat(opts: {
  sessionId: string
  files: FilesPort
  io: SessionIo
}): SideChatPort {
  return {
    attachedId: opts.sessionId,
    log(sessionId) {
      return opts.io.log(sessionId)
    },
    roster() {
      return opts.io.roster()
    },
    read(path) {
      return opts.files.read(path)
    },
    search(query) {
      const needle = query.trim().toLowerCase()
      if (needle.length === 0) return []
      const hits: SearchHit[] = []
      for (const node of opts.files.tree()) {
        const text = opts.files.read(node.path)
        if (text === undefined || text.startsWith('data:')) continue
        if (text.toLowerCase().includes(needle)) {
          hits.push({ path: node.path, text })
        }
      }
      return hits
    },
    deliver(payload: SourcedDelivery) {
      const entry = opts.io.roster().find((row) => row.id === payload.to)
      if (entry === undefined) return { ok: false, error: 'unknown' }
      if (entry.archived) return { ok: false, error: 'archived' }
      if (entry.kind !== 'main') return { ok: false, error: 'rejected' }
      return { ok: true, queued: entry.busy }
    },
  }
}
