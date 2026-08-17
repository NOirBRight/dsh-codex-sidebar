# dsh-codex-sidebar

Codex-app-style 侧栏 for one DeepSeek Harness 主会话. Files, Review, Browser, Terminal, and Side Chat share one Tab strip on the current session.

## Local install (Web)

Build first. DSH loads `lib/` from this package; GitHub/`dsh plugin add github:...` is not the path until this repo is published.

```sh
pnpm install
pnpm test
pnpm run build
dsh plugin --profile web add "$(pwd)"
dsh web
```

If you are on the `host-wire-ports` worktree:

```sh
cd /tmp/dsh-host-wire
pnpm install
pnpm run build
dsh plugin --profile web add /tmp/dsh-host-wire
dsh web
```

Then open a 主会话. The 侧栏开关 is in the conversation header. Click a workspace path to fill Files; click an `http(s)` URL to fill Browser.

## What works live

- **Files** — read-only preview (source, Markdown, images), tree, 批注 at the mark
- **Review** — 本轮变更 from the 主会话 log, then working-tree leftovers; no stage/revert/commit
- **Browser** — iframe of the URL, 批注 overlay; the 侧栏 does not start the project
- **Terminal** — human pty (`script` when present)
- **Side Chat** — Fork at first send, 列出 / 察看 / 投递 to other 主会话s (投递 is labeled text queued on the target)

Chrome follows the DSH host theme. Tabs persist with that 主会话.

## Spec

See `CONTEXT.md` and `.scratch/codex-sidebar/spec.md`.
