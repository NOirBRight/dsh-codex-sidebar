# 05 — Side Chat: Fork、列出、察看、投递

**What to build:** A Side Chat Tab answers without interrupting the 舵主. Opening it is free; the first send Forks the 主会话 (completed turns plus in-flight tools, no unfinished final reply) and that Fork stays frozen. 列出 returns unarchived 主会话s in this DSH Web profile (any workspace), never subagents or other Side Chats. 察看 returns a 进度卡片. 投递 lands on a 主会话 as a labeled sourced card, not a user message, and queues like ordinary chat when that 主会话 is busy. Side Chat may read/search files; it cannot write, run Terminal, or spawn.

**Blocked by:** 01 — Files: 点路径就能预览和批注

**Status:** resolved

- [x] First send Forks then freezes; a follow-up does not rewrite the Fork; a new Side Chat Tab is a new Fork
- [x] Empty Tab has no Fork; empty state matches the signed-off prototype (Codex-shaped, this product's copy)
- [x] 列出 is profile-wide 主会话s only; 察看 yields a 进度卡片 and does not unfreeze the Fork
- [x] 投递 is sourced, not user-role, including to the current 主会话; busy target queues; failed 投递 stays visible in Side Chat
- [x] Read/search allowed; write, pty, and spawn rejected
- [x] Tests drive the Side Chat seam with a fake log (including in-flight), a cross-cwd roster, and a subagent that must not appear: Fork, 列出, 察看, 投递, read ok, write/spawn rejected
