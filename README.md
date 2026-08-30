# dsh-codex-sidebar

English | [中文](README.zh.md)

A Codex-app-style right-hand sidebar for one [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) session. Files, Review, Browser, and Terminal share a tab strip on the current session.

![Conversation plus Files preview in the sidebar](docs/screenshots/01-overview.png)

## What it does

Open a session, then use the sidebar toggle in the conversation header. The drawer occupies the details column of the DSH frame. It does not replace the chat.

- **Files** — read-only preview (source, Markdown, images) and a workspace tree. Click a path in the transcript to fill it.
- **Review** — this turn's changes from the session log, then leftover working-tree diffs. Read-only: no stage, revert, or commit.
- **Browser** — a managed Chromium document in that tab. The session can call `browser_tabs`, `browser_open`, `browser_snapshot`, `browser_click`, and `browser_fill` on HTTP(S) pages and explicit local HTML files whether the sidebar is open or closed. The Host owns the revisioned page viewport, so media dimensions cannot resize the page or move input coordinates. Direct video uses a Browser-owned, STUN-only WebRTC peer when available; the authenticated control WebSocket retains a bounded JPEG fallback for constrained Mobile tunnels. Disposing a DSH session closes its control connections and managed Pages immediately. Hiding the Browser only releases media after the configured grace period and keeps the Page available for Agent tools. Idle tabs are closed; opening the DSH web GUI inside this browser is rejected.
- **Terminal** — a human pty (`script` when present), not an agent shell.
- **Annotations** — click a line or a page to write a note at the mark. Send keeps the official user bubble; numbered chips sit under it. Locators and screenshots go to the model as evidence on that same user message.
- **Edit +/−** — each edit/write tool row shows the increment for that call, after the filename.

![Review of this turn's changes with per-file +/−](docs/screenshots/03-review.png)

Chrome follows the DSH host theme. Tabs persist with that session. Side Chat is retired; cross-session questions belong to the DeepSeek assistant's task-reference flow.

![Browser empty state](docs/screenshots/04-browser.png)

![Human terminal](docs/screenshots/05-terminal.png)

![Empty-tab palette](docs/screenshots/06-palette.png)

## Installation

The exact official DeepSeek Harness 0.1.2-alpha.1 release is required. Later 0.1.2 prereleases or finals remain unsupported until this plugin is revalidated against their public Client contracts. Install from GitHub:

```sh
dsh plugin --profile web add github:NOirBRight/dsh-codex-sidebar#v0.5.6
dsh web
```

Lab (`DSH_HOME=~/.dsh-lab`) uses the same package name:

```sh
DSH_HOME=~/.dsh-lab dsh plugin --profile web add github:NOirBRight/dsh-codex-sidebar#v0.5.6
```

The repository tracks release-ready `lib/` artifacts, so GitHub installation needs no build-script allowlist.

Version 0.5.6 drives managed Chromium with the same Google Chrome as the GUI so Direct video ICE shares host routes, and raises the Tab + menu above Review chrome.

Version 0.5.0 moves the Client integration to the exact official 0.1.2-alpha.1 modules (`ui-session`, `ui-conversation`, `ui-chat`, Client store, and API Remotes) after `dsh-client-runtime` was removed. Transcript consumers read canonical Chat nodes through one plugin Adapter; the current `legacy` compatibility slice is only a fallback inside that Adapter. It also rejoins the bounded Browser transport from 0.3.23 with the revisioned Browser v2 implementation; the 0.4.x Alpha adaptation line did not contain that parallel Browser work.

Since 0.3.0, Review/Files workspace projection is asynchronous and demand-driven: a collapsed sidebar does not scan git, Review rows use summaries, and file details load only when opened. Sidebar state is isolated under `DSH_HOME`, with on-demand fallback migration from `~/.dsh-codex-sidebar/sessions`. Very large or binary file details are bounded summaries rather than unbounded LCS diffs, so the host remains responsive.

Do not list `@deepseek-ai/dsh-tools` (or other host singletons) as a plugin `dependency`. A hoisted copy shadows the host ToolRuntime and every tool call dies on `.prepare`.

The managed Chromium profile has a 256 MiB derived-cache budget by default. Managed Browser layout, direct media, and fallback limits are also validated loader configuration:

```yaml
- name: dsh-codex-sidebar
  config:
    managedBrowser:
      cacheBudgetBytes: 268435456
      layoutMinViewport: { width: 320, height: 240 }
      layoutMaxViewport: { width: 1920, height: 1440 }
      layoutSettleMs: 180
      layoutHysteresisPx: 8
      layoutPaintTimeoutMs: 1000
      preferredMediaRoute: webrtc-preferred
      stunUrls: []
      webrtcNegotiationTimeoutMs: 5000
      webrtcRetryCooldownMs: 30000
      maxMediaPeers: 3
      maxEncoderPages: 3
      directVideoFrameRate: 10
      directVideoMaxBitrate: 2000000
      directVideoCaptureQuality: 80
      directVideoCaptureMaxScale: 1.5
      directVideoCaptureMaxRawBytes: 491520
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
      browserCleanupTimeoutMs: 2000
```

The fixed phone, tablet, and laptop presets remain `390×844`, `768×1024`, and `1280×800`. Fit mode proposes one clamped viewport only after the container settles; selecting a fixed preset sends exactly one proposal through its v2 control connection and never commits through the persisted session or ticket path. Fixed presets never consume container resize observations. The Host verifies the exact target Page's CSS viewport after every proposal, including an unchanged one, and again after the first screencast starts on a fixed-layout connection. It does not use that screencast for capture or start direct-media negotiation until the reconnect verification finishes. During a viewport transition it pauses visual reads, media capture, and input without closing the control connection; an internal epoch discards work that crossed even an unchanged-layout verification, while visual results and gestures also recheck their originating document. The client sends each desktop press/release as one atomic tap or drag, and the Host serializes that complete gesture with viewport writes; evidence selection is canceled if its press and release use different presented revisions. A completed action is not reported as failed merely because a transition queued behind it. A completed Mobile touch tap opens the hidden IME and pauses fit proposals until blur; touch scrolling and desktop focus do not pause fit. This reconnect check repairs a Page whose actual viewport drifted while retaining the existing revision and media generation. The Host uses an identity-bound CDP metrics override when Playwright completes without applying the dimensions and closes the target rather than publishing or streaming an unverified layout. Each control connection binds one exact managed Page/CDP identity and disconnects when that target is replaced. WebRTC carries video only and does not request camera, microphone, or audio. `stunUrls` accepts only `stun:` URLs; TURN is rejected. An empty list still permits host ICE candidates, while deployments that need NAT discovery must configure approved STUN servers. `jpeg-only` is available as a diagnostic `preferredMediaRoute`.

The Origin-less Mobile tunnel wraps the Browser JSON frame in another Base64 envelope. Its default 96 KiB limit applies to the encoded JPEG bytes and leaves the complete tunnel plaintext below the 200 KiB ceiling. Browser evidence remains an exact, separate Page capture; its read RPC requires an explicit offset and returns at most 96 KiB of raw JPEG as Base64 with a next offset, rather than sending a multi-megabyte response through the tunnel. The fallback may lower JPEG quality or encoded resolution, but it never changes the committed CSS viewport. `desktopJpegFrameIntervalMs` and `mobileJpegFrameIntervalMs` are hard capture-rate ceilings, including interaction-triggered frames. Each interaction, navigation, refresh, or layout commit permits at most `desktopJpegInteractionBurstFrames` or `mobileJpegInteractionBurstFrames` later passive screencast updates; animation alone becomes quiet when that budget is exhausted. New activity replenishes the budget and retains the latest dirty update. Direct WebRTC video uses the separate `directVideoCaptureQuality`, `directVideoCaptureMaxScale`, and `directVideoCaptureMaxRawBytes` profile against the Host-committed viewport, regardless of whether the control socket has an Origin. These encoder-only JPEG bytes never enter the Mobile tunnel. Each connection retains at most one capture, one unacknowledged frame, and one latest dirty request.

The Browser surface reports `Direct video`, `Low-bandwidth fallback`, `Reconnecting video`, or `Video unavailable` from the route that is actually presentable to the user. Autoplay, decode, missing-track, first-frame, peer, and local negotiation failures decline only the exact current media identity, allowing the Host to restore JPEG without letting a stale generation disrupt the current route.

`ManagedBrowserStream.diagnostics()` exposes fixed-memory counters, gauges, and latency aggregates without page URLs or content. It includes the latest viewport revision/media generation; capture, fallback encoding/send, encoder Canvas paint, and end-to-end fallback acknowledgement latency; encoded bytes and route-budget drops; media outcomes; and current peer, encoder Page, capture, socket, and timer counts. `resources()` remains limited to its existing socket, timer, capture, unacknowledged-frame, and peer ownership fields. At media capacity, the oldest hidden owner is released first, then the oldest still-fallback negotiation; visible active direct-video peers are never capacity-evicted, and a request falls back with `local-capacity` when no safe victim exists. `maxMediaPeers` must not exceed `maxEncoderPages`; invalid capacity configuration fails during plugin load.

The values above are the defaults. `mediaIdleTimeoutMs` releases an inactive direct-video peer while keeping the target Page alive; later interaction may negotiate again after the retry cooldown. When the document or Browser surface becomes hidden, `mediaHideGraceMs` keeps the control connection alive for a short recovery window. Switching to another tool Tab retains the Browser surface as hidden and inert during this interval, so it occupies no layout and accepts no input. Returning before the deadline cancels teardown; expiry closes the control connection and releases its peer and encoder without closing the target Page. `browserCleanupTimeoutMs` bounds how long ordinary Tab close, failed Page creation, and plugin shutdown wait for Browser-owned cleanup. Plugin shutdown revokes local HTML capabilities immediately before waiting for stream sockets, Chromium targets, and other owned work.

Before launch, the plugin performs a read-only, no-follow size estimate over allowlisted derived-cache directories. Chromium's persistent-context startup owns singleton arbitration; the plugin does not rename, remove, or repair profile paths. After a context starts successfully, an over-budget estimate triggers one temporary blank Page and CDP session that run `Network.enable` and `Network.clearBrowserCache`, then always detach and close. Clear failures warn without discarding the context. Chromium's cache API leaves cookies, Local Storage, and IndexedDB intact, while disk and media cache launch arguments limit future growth.

The Browser address bar also accepts an absolute `file:///.../page.html` or `.htm` address. The Host requires a regular, non-symlink entry and projects its canonical parent through a random capability on a separate server bound only to `127.0.0.1:0`; relative assets stay inside that parent, directory listings and traversal are refused, and only `GET`/`HEAD` are served. After open, the Host revalidates the requested path and rejects the request when its observed device/inode identity differs from the open handle. These checks reject static symlinks and observed path changes; they are not a security boundary against a process running as the same operating-system user and concurrently modifying authorized files. Same-Tab opens are serialized and share one Page/CDP identity. Chromium alone receives the private HTTP address. Session state, tools, diagnostics, snapshot accessible names, Browser outlines, desktop clients, and remote Mobile clients continue to see the public `file:` address or a redacted gateway label, never the loopback port or capability. Closing the Tab or session revokes its directory; plugin disposal revokes every capability before waiting for Chromium teardown and closes the listener independently of stalled Browser cleanup. External-open remains HTTP(S)-only.

Local HTML is active content. Its scripts can read resources served from the selected HTML directory and can initiate network requests. Open only HTML you trust; place generated prototypes in a dedicated directory rather than beside credentials or unrelated files.

## Local install

Client typechecking is pinned to the official `dsh-v0.1.2-alpha.1` declarations. Point `DSH_ALPHA1_CHECKOUT` at a clean checkout of that exact tag after running the official `pnpm install --frozen-lockfile && pnpm run build` there; the checkout is read only as a development type fixture and is never packaged.

```sh
pnpm install
DSH_ALPHA1_CHECKOUT=/path/to/deepseek-harness-alpha1 pnpm run check
dsh plugin --profile web add "$(pwd)"
dsh web
```

Then open a session and use the sidebar toggle.

## Spec

See `CONTEXT.md` and `docs/adr/`.
