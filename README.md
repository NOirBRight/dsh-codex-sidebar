# dsh-codex-sidebar

English | [中文](README.zh.md)

A Codex-app-style right-hand sidebar for one [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) session. Files, Review, Browser, and Terminal share a tab strip on the current session.

![Conversation plus Files preview in the sidebar](docs/screenshots/01-overview.png)

## What it does

Open a session, then use the sidebar toggle in the conversation header. The drawer occupies the details column of the DSH frame. It does not replace the chat.

- **Files** — read-only preview (source, Markdown, images) and a workspace tree. Click a path in the transcript to fill it.
- **Review** — this turn's changes from the session log, then leftover working-tree diffs. Read-only: no stage, revert, or commit.
- **Browser** — a managed Chromium document in that tab. The session can call `browser_tabs`, `browser_open`, `browser_snapshot`, `browser_click`, and `browser_fill` on loopback HTTP pages whether the sidebar is open or closed. The Host owns the revisioned page viewport, so media dimensions cannot resize the page or move input coordinates. Direct video uses a Browser-owned, STUN-only WebRTC peer when available; the authenticated control WebSocket retains a bounded JPEG fallback for constrained Mobile tunnels. Disposing a DSH session closes its control connections and managed Pages immediately. Hiding the Browser only releases media after the configured grace period and keeps the Page available for Agent tools. Idle tabs are closed; opening the DSH web GUI inside this browser is rejected.
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

The managed Chromium profile has a 256 MiB derived-cache budget by default. Managed Browser layout, direct media, and fallback limits are also validated loader configuration:

```yaml
- name: dsh-codex-sidebar
  config:
    managedBrowser:
      cacheBudgetBytes: 268435456
      layoutSettleMs: 180
      layoutHysteresisPx: 8
      preferredMediaRoute: webrtc-preferred
      stunUrls: []
      webrtcNegotiationTimeoutMs: 5000
      webrtcRetryCooldownMs: 30000
      maxMediaPeers: 3
      maxEncoderPages: 3
      directVideoFrameRate: 10
      directVideoMaxBitrate: 2000000
      desktopJpegQuality: 80
      desktopJpegFrameIntervalMs: 100
      desktopJpegMaxScale: 1.5
      desktopScreencastEveryNthFrame: 2
      desktopJpegInteractionBurstFrames: 20
      desktopJpegMaxRawBytes: 491520
      mobileJpegQuality: 65
      mobileJpegFrameIntervalMs: 250
      mobileJpegMaxScale: 1
      mobileScreencastEveryNthFrame: 4
      mobileJpegInteractionBurstFrames: 4
      mobileJpegMaxRawBytes: 98304
      mediaIdleTimeoutMs: 300000
      mediaHideGraceMs: 15000
      streamShutdownTimeoutMs: 2000
```

The fixed phone, tablet, and laptop presets remain `390×844`, `768×1024`, and `1280×800`. Fit mode proposes one clamped viewport only after the container settles; fixed presets never consume container resize observations. WebRTC carries video only and does not request camera, microphone, or audio. `stunUrls` accepts only `stun:` URLs; TURN is rejected. An empty list still permits host ICE candidates, while deployments that need NAT discovery must configure approved STUN servers. `jpeg-only` is available as a diagnostic `preferredMediaRoute`.

The Origin-less Mobile tunnel wraps the Browser JSON frame in another Base64 envelope. Its default 96 KiB limit applies to the encoded JPEG bytes and leaves the complete tunnel plaintext below the 200 KiB ceiling. The fallback may lower JPEG quality or encoded resolution, but it never changes the committed CSS viewport. `desktopJpegFrameIntervalMs` and `mobileJpegFrameIntervalMs` are hard capture-rate ceilings, including interaction-triggered frames. Each interaction, navigation, refresh, or layout commit permits at most `desktopJpegInteractionBurstFrames` or `mobileJpegInteractionBurstFrames` later passive screencast updates; animation alone becomes quiet when that budget is exhausted. New activity replenishes the budget and retains the latest dirty update. Direct WebRTC video does not use this fallback budget. Each connection retains at most one capture, one unacknowledged frame, and one latest dirty request.

The values above are the defaults. `mediaIdleTimeoutMs` releases an inactive direct-video peer while keeping the target Page alive; later interaction may negotiate again after the retry cooldown. When the document or Browser surface becomes hidden, `mediaHideGraceMs` keeps the control connection alive for a short recovery window. Returning before the deadline cancels teardown; expiry closes the control connection and releases its peer and encoder without closing the target Page. Plugin shutdown gives stream sockets and owned work `streamShutdownTimeoutMs` to settle, then terminates unresponsive sockets and stops retaining unfinished task bookkeeping.

Before launch, the plugin performs a read-only, no-follow size estimate over allowlisted derived-cache directories. Chromium's persistent-context startup owns singleton arbitration; the plugin does not rename, remove, or repair profile paths. After a context starts successfully, an over-budget estimate triggers one temporary blank Page and CDP session that run `Network.enable` and `Network.clearBrowserCache`, then always detach and close. Clear failures warn without discarding the context. Chromium's cache API leaves cookies, Local Storage, and IndexedDB intact, while disk and media cache launch arguments limit future growth.

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
