# 01 — Files: 点路径就能预览和批注

**What to build:** A DSH Web plugin hangs off the current 主会话. An empty Tab shows the Palette; choosing Files fills it with a read-only preview on the left and a closable tree on the right. Clicking a file path in the 主会话 expands the 侧栏 and reuses a Tab already showing that path. 批注 starts with the pencil; the composer appears only after clicking previewed content, next to that mark. Enter stacks on the 主会话 composer; Ctrl+Enter (or composer send) goes to the 主会话, queued the same way as chat when it is busy. Closing the last Tab collapses the 侧栏; the 侧栏开关 and another path click bring the same Tab strip back. Chrome follows the DSH host theme. Tabs persist with that 主会话.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Palette → Files fills the Tab; `+` opens another empty Tab; the 侧栏开关 hides and shows without destroying Tabs
- [x] Closing the last Tab collapses the 侧栏; a path click or Palette pick expands it and restores the strip
- [x] Same path reuses a Files Tab; a different path opens another; preview cannot save edits
- [x] 批注 composer is absent until a content click, sits at the mark, moves on a later click, Esc dismisses; Enter stacks, Ctrl+Enter sends to the 主会话 (never Side Chat)
- [x] Chrome tokens follow the host theme; look and IA match the signed-off prototype, not the v1 dump
- [x] SidebarSession (Tab strip, collapse) persists with the 主会话 identity; a different 主会话 has its own strip
- [x] Tests drive the Files seam with fake workspace bytes: open/reuse, read-only preview, 批注 Enter / Ctrl+Enter land on the 主会话 composer. No React, live browser, or live DSH process.
