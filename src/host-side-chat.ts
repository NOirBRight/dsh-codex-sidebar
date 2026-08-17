/** Host SideChatPort: live cwd read/search. Log, roster, and 投递 need a DSH adapter. */

import type { FilesPort } from './session.ts'
import type { SearchHit, SideChatPort } from './side-chat.ts'

export function createHostSideChat(opts: {
  sessionId: string
  files: FilesPort
}): SideChatPort {
  return {
    attachedId: opts.sessionId,
    log() {
      return []
    },
    roster() {
      return []
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
        if (text !== undefined && text.toLowerCase().includes(needle)) {
          hits.push({ path: node.path, text })
        }
      }
      return hits
    },
    deliver() {
      return { ok: false, error: 'unavailable' }
    },
  }
}
