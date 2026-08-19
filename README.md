# dsh-codex-sidebar

Codex-app-style 侧栏 for one DeepSeek Harness 主会话. Files, Review, Browser, and Terminal share one Tab strip on the current session.

## Installation

DeepSeek Harness 0.1.0-rc.6 or later. Install from GitHub:

```sh
dsh plugin --profile web add github:NOirBRight/dsh-codex-sidebar#v0.2.2
dsh web
```

Lab (`DSH_HOME=~/.dsh-lab`) uses the same package name:

```sh
DSH_HOME=~/.dsh-lab dsh plugin --profile web add github:NOirBRight/dsh-codex-sidebar#v0.2.2
```

The repository tracks release-ready `lib/` artifacts, so GitHub installation needs no build-script allowlist.

## Local install (Web)

Build first. DSH loads `lib/` from this package.

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
- **Browser** — iframe of the URL, 批注 overlay; the 侧栏 does not start the project. The 主会话 can `browser_tabs` / `browser_open` / `browser_snapshot` / `browser_click` / `browser_fill` on loopback http pages in that same Tab, whether the 侧栏 is open or closed. Opening the 侧栏 later shows the same document.
- **Terminal** — human pty (`script` when present)
- Side Chat 已退场；跨会话问答由 DeepSeek 小管家的“引用任务”承担，侧栏不再创建会话 fork。

Chrome follows the DSH host theme. Tabs persist with that 主会话.

## Spec

See `CONTEXT.md` and `.scratch/codex-sidebar/spec.md`.
