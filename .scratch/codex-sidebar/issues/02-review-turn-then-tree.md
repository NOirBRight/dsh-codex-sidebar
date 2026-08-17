# 02 — Review: 先看本轮变更

**What to build:** A Review Tab shows a read-only diff. It opens on 本轮变更 (writes from the current or latest unfinished 主会话 turn). The human can switch to the full working tree. Clicking a file expands a unified diff; a gutter `+` starts a 批注 that uses the same Enter / Ctrl+Enter rules as Files. Review never stages, reverts, or commits. A finding sent from Review is an instruction to the 舵主, not a git write.

**Blocked by:** 01 — Files: 点路径就能预览和批注

**Status:** ready-for-agent

- [ ] Default open is 本轮变更; switching to working tree shows human leftover files the 舵主 did not write this turn
- [ ] Empty 本轮变更 stays empty — it does not silently fall back to the working tree
- [ ] Diff is read-only: no stage, revert, or commit effects
- [ ] File row expands unified diff; gutter `+` 批注 stacks or sends to the 主会话 composer like Files
- [ ] Tests drive the Review seam with fake 主会话 write events and a fake git tree: default, switch, no git writes, finding is a composer attachment/send
