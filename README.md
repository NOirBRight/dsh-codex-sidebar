# dsh-codex-sidebar

English | [中文](README.zh.md)

A Codex-app-style right-hand sidebar for one [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) session. Files, Review, Browser, and Terminal share a tab strip on the current session.

![Conversation plus Files preview in the sidebar](docs/screenshots/01-overview.png)

## What it does

Open a session, then use the sidebar toggle in the conversation header. The drawer occupies the details column of the DSH frame. It does not replace the chat.

- **Files** — read-only preview (source, Markdown, images) and a workspace tree. Click a path in the transcript to fill it.
- **Review** — this turn's changes from the session log, then leftover working-tree diffs. Read-only: no stage, revert, or commit.
- **Browser** — a managed Chromium document in that tab. The session can call `browser_tabs`, `browser_open`, `browser_snapshot`, `browser_click`, and `browser_fill` on loopback HTTP pages whether the sidebar is open or closed. Desktop streams use binary frames; the Origin-less Mobile tunnel uses JSON Base64. Paint acknowledgements bound capture and delivery work. Idle tabs are closed; opening the DSH web GUI inside this browser is rejected.
- **Terminal** — a human pty (`script` when present), not an agent shell.
- **Annotations** — click a line or a page to write a note at the mark. Send keeps the official user bubble; numbered chips sit under it. Locators and screenshots go to the model as evidence on that same user message.
- **Edit +/−** — each edit/write tool row shows the increment for that call, after the filename.

![Review of this turn's changes with per-file +/−](docs/screenshots/03-review.png)

Chrome follows the DSH host theme. Tabs persist with that session. Side Chat is retired; cross-session questions belong to the DeepSeek assistant's task-reference flow.

![Browser empty state](docs/screenshots/04-browser.png)

![Human terminal](docs/screenshots/05-terminal.png)

![Empty-tab palette](docs/screenshots/06-palette.png)

## Installation

DeepSeek Harness 0.1.0-rc.6 or later. Install from GitHub:

```sh
dsh plugin --profile web add github:NOirBRight/dsh-codex-sidebar#v0.3.23
dsh web
```

Lab (`DSH_HOME=~/.dsh-lab`) uses the same package name:

```sh
DSH_HOME=~/.dsh-lab dsh plugin --profile web add github:NOirBRight/dsh-codex-sidebar#v0.3.23
```

The repository tracks release-ready `lib/` artifacts, so GitHub installation needs no build-script allowlist.

Since 0.3.0, Review/Files workspace projection is asynchronous and demand-driven: a collapsed sidebar does not scan git, Review rows use summaries, and file details load only when opened. Sidebar state is isolated under `DSH_HOME`, with on-demand fallback migration from `~/.dsh-codex-sidebar/sessions`. Very large or binary file details are bounded summaries rather than unbounded LCS diffs, so the host remains responsive.

Do not list `@deepseek-ai/dsh-tools` (or other host singletons) as a plugin `dependency`. A hoisted copy shadows the host ToolRuntime and every tool call dies on `.prepare`.

The managed Chromium profile has a 256 MiB derived-cache budget by default. Configure it in the plugin loader entry when another limit is required:

```yaml
- name: dsh-codex-sidebar
  config:
    managedBrowser:
      cacheBudgetBytes: 268435456
```

Before Chromium launches, a recoverable profile lease serializes initialization across Host processes. When allowlisted caches exceed the budget, the plugin rechecks ownership, atomically detaches each unchanged directory to a plugin-specific quarantine name, rechecks ownership again, and recursively removes only that detached quarantine. A new singleton, changed directory identity, or uncertain ownership retains the quarantine instead of deleting it; stale Chromium singleton files are left for Chromium to arbitrate. Cookies and site storage are preserved. Expired orphan or corrupt leases are reclaimed by verified directory identity, while release failures warn without discarding an already launched context.

## Local install

```sh
pnpm install
pnpm test
pnpm run build
dsh plugin --profile web add "$(pwd)"
dsh web
```

Then open a session and use the sidebar toggle.

## Spec

See `CONTEXT.md` and `docs/adr/`.
