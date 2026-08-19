# dsh-codex-sidebar

English | [中文](README.zh.md)

A Codex-app-style right-hand sidebar for one [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 主会话. Files, Review, Browser, and Terminal share a Tab strip on the current session.

![Conversation plus Files preview in the 侧栏](docs/screenshots/01-overview.png)

## What it does

Open a 主会话, then use the 侧栏开关 in the conversation header. The drawer occupies the details column of the DSH frame — it does not replace the chat.

- **Files** — read-only preview (source, Markdown, images) and a workspace tree. Click a path in the transcript to fill it.
- **Review** — 本轮变更 from the 主会话 log, then working-tree leftovers. Read-only: no stage, revert, or commit.
- **Browser** — a managed Chromium document in that Tab. The 主会话 can `browser_tabs` / `browser_open` / `browser_snapshot` / `browser_click` / `browser_fill` on loopback http pages whether the 侧栏 is open or closed.
- **Terminal** — a human pty (`script` when present), not an agent shell.
- **批注** — click a line or a page to write a note at the mark. Send keeps the official user bubble; numbered chips sit under it. Locators and screenshots go to the model as evidence on that same user message.
- **Edit +/−** — each edit/write tool row shows the increment for that call, after the filename.

![Review: 本轮变更 with per-file +/−](docs/screenshots/03-review.png)

Chrome follows the DSH host theme. Tabs persist with that 主会话. Side Chat is retired; cross-session questions belong to DeepSeek 小管家 引用任务.

![Browser empty state](docs/screenshots/04-browser.png)

![Human Terminal](docs/screenshots/05-terminal.png)

![Empty Tab palette](docs/screenshots/06-palette.png)

## Installation

DeepSeek Harness 0.1.0-rc.6 or later. Install from GitHub:

```sh
dsh plugin --profile web add github:NOirBRight/dsh-codex-sidebar#v0.2.4
dsh web
```

Lab (`DSH_HOME=~/.dsh-lab`) uses the same package name:

```sh
DSH_HOME=~/.dsh-lab dsh plugin --profile web add github:NOirBRight/dsh-codex-sidebar#v0.2.4
```

The repository tracks release-ready `lib/` artifacts, so GitHub installation needs no build-script allowlist.

Do not list `@deepseek-ai/dsh-tools` (or other host singletons) as a plugin `dependency`. A hoisted copy shadows the host ToolRuntime and every tool call dies on `.prepare`.

## Local install

```sh
pnpm install
pnpm test
pnpm run build
dsh plugin --profile web add "$(pwd)"
dsh web
```

Then open a 主会话 and use the 侧栏开关.

## Spec

See `CONTEXT.md` and `docs/adr/`.
