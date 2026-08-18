# 04 — Terminal: 人的 pty

**What to build:** A Terminal Tab is the human's shell in the 主会话 workspace, full pane height. Each Terminal Tab has its own pty. Closing the Tab destroys that pty. Output is not injected into the 主会话. The 舵主 keeps using its own command tools and never shares this stdin. Reopening the 主会话 may reconnect if the host still holds the token.

**Blocked by:** 01 — Files: 点路径就能预览和批注

**Status:** resolved

- [x] Terminal fills the 工具 pane; cwd is the 主会话 workspace
- [x] Two Terminal Tabs do not share stdin; close Tab destroys that pty
- [x] Typed commands and output never appear as 主会话 turns
- [x] 舵主 tool commands do not attach to this pty
- [x] Tests drive the Terminal seam with a fake pty port: one pty per Tab, close destroys, no inject, no shared stdin with the 舵主
- [x] Host adapter is a real pty; the pane is an emulator (resize + incremental pull). Tests still use a fake port
