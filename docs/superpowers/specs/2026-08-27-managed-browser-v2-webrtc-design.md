# Managed Browser v2: authoritative layout and direct WebRTC media

- Status: Approved for implementation planning
- Date: 2026-08-27
- Owners: `dsh-codex-sidebar`, with bounded validation work in `dsh-mobile`

## Context

The Sidebar Browser must remain an interactive browser inside the Sidebar, support sites that reject framing, let the human and Agent operate the same page, and work through desktop and Mobile clients without a separate desktop application. A Host-managed Chromium page therefore remains the authoritative page. An iframe cannot satisfy these requirements because sites such as GitHub deny framing and a cross-origin parent cannot provide the required DOM access, automation, screenshot evidence, or shared page state.

The current display path uses CDP screencast events as change signals, captures JPEG screenshots, sends them over a WebSocket, and paints them into a Canvas. It has two independent defects:

1. Page geometry has multiple writers. The client proposes a viewport from its container, the Host resizes Chromium, and every delivered frame can then overwrite the client viewport and Canvas surface dimensions.
2. The Host treats `Page.screencastFrame.metadata.deviceWidth` and `deviceHeight` as page viewport dimensions. CDP defines those fields as device screen dimensions in DIP, not the layout or visual viewport. Fixed device presets therefore do not prevent later media frames from changing the presented geometry.

Backpressure bounds capture and delivery work but does not correct this geometry model. Replacing JPEG delivery with WebRTC without correcting geometry would preserve the same visible resize loop.

DSH Mobile adds a second constraint. Its normal connection is an encrypted tunnel with a 200 KiB plaintext-frame ceiling and an approximately 1 Mbps operational budget. A direct STUN-only WebRTC DataChannel is attempted opportunistically, but restrictive mobile networks often remain on the tunnel. Browser media must therefore prefer direct WebRTC while retaining a low-bandwidth, interaction-first fallback that never blocks control input.

## Goals

- Keep one Host-managed Chromium page for human interaction, Agent automation, and Browser evidence.
- Keep Browser content inside the Sidebar on desktop and Mobile.
- Make Host-committed page geometry the only authority for layout and input coordinates.
- Remove visible resize oscillation for fixed presets and adaptive layout.
- Prefer direct WebRTC video when ICE succeeds without TURN.
- Remain reliably operable through the Mobile tunnel when direct media is unavailable.
- Use one Browser protocol and one client implementation across desktop and Mobile.
- Preserve exact, separately captured Browser evidence.
- Bound every page, peer, timer, frame, retry, queue, and encoder lifecycle.
- Require no DSH Core changes.

## Non-goals

- A desktop application, Electron shell, native WebView, or browser extension.
- TURN service deployment or guaranteed smooth video on every network.
- Streaming audio from the managed page.
- Replacing Browser evidence with video frames.
- Reusing or depending on internal state from the DSH Mobile Pairing peer connection.
- Making the existing Mobile tunnel a general image, file, or media transport.

## Decision summary

Managed Browser v2 separates a reliable control plane from a negotiated media plane:

```text
Browser control WebSocket
  - authentication and protocol negotiation
  - layout proposal and commit
  - input, page state, errors, and lifecycle
  - WebRTC signaling
  - bounded JPEG fallback

Direct WebRTC media
  - video only
  - STUN-only ICE
  - plugin-owned peer connection
  - automatic fallback on timeout or failure
```

The control plane is always available before media begins. WebRTC is the preferred carrier, not the owner of page geometry. JPEG fallback uses the same committed layout state and input protocol.

## Geometry model

Managed Browser v2 keeps three distinct sizes:

- `containerSize`: the local Sidebar display area.
- `committedViewport`: the Host-confirmed Chromium CSS viewport.
- `encodedSize`: the JPEG or video pixel dimensions.

Only `committedViewport` affects page reflow, Browser evidence coordinates, and input coordinates. `encodedSize` affects visual fidelity only. A media frame cannot change `containerSize` or `committedViewport`.

Each Browser Tab has one Host-owned layout state:

```ts
type BrowserLayout = {
  revision: number
  mode: 'fit' | 'phone' | 'tablet' | 'laptop'
  viewport: { width: number; height: number }
  mediaGeneration: number
}
```

The existing fixed presets remain:

- phone: 390 x 844
- tablet: 768 x 1024
- laptop: 1280 x 800

The `fit` preset is a negotiated size, not a continuously shared measurement.

### Fixed presets

Selecting a fixed preset sends one layout proposal. The Host validates and applies the exact preset, increments `revision` and `mediaGeneration`, and publishes a layout commit. ResizeObserver output cannot modify a fixed preset.

### Adaptive layout

In `fit` mode, the client measures the Browser container and proposes a clamped CSS viewport only after the measurement remains stable for a configurable settle interval. It applies configurable jitter hysteresis and retains only the latest unsent proposal. While the human drags the Sidebar, the client scales the last good presentation locally and does not resize Chromium continuously.

The Host serializes layout commits and retains only the latest pending proposal. A commit is published only after `page.setViewportSize()` completes. Media startup waits for the initial commit, so a connection does not display an initial frame with unrelated default geometry.

Mobile suspends adaptive proposals while the local IME is visible. It does not use `visualViewport.height` as the remote page height. A stable orientation or container-layout change may submit one new proposal after the IME closes or the layout settles.

### Atomic presentation switch

The client keeps the previous presentation until media for the new generation is ready. The Host pauses media publication, applies the new viewport, resets the encoder surface, requests a keyframe when applicable, and publishes the new layout commit. The client atomically changes its presented layout after the first new-generation JPEG frame or the first matching video frame is ready.

Input is briefly held during this transition. Old-revision input is never applied to a newly reflowed page. Old layout commits, frames, and media generations are ignored.

### CDP use

`Page.screencastFrame` remains an optional dirty signal. Its `deviceWidth`, `deviceHeight`, and `pageScaleFactor` are diagnostic data only. Screenshot width and height always come from `committedViewport`. `Page.getLayoutMetrics().visualViewport.pageX` and `pageY` may provide the scroll origin for a viewport clip, but its dimensions do not replace the committed viewport.

## Control protocol v2

The internal Browser stream protocol becomes version 2. Host and client fail closed on an unsupported version; there is no unbounded legacy mode.

Client messages include:

- `hello`: protocol version, media and frame capabilities, and flow-control support.
- `layout-propose`: mode, proposed viewport, and client proposal sequence.
- `input`: input payload and the revision currently presented to the human.
- `frame-ack`: JPEG sequence, revision, and media generation.
- `rtc-answer` and `rtc-candidate`: authenticated WebRTC signaling.
- `media-decline`: exact owner, layout revision, and media generation when negotiated video cannot present its first decoded frame.
- `media-retry`: an explicit retry after a user action or recognized network change.

Host messages include:

- `ready`: selected protocol, control features, and fallback profile.
- `layout-commit`: revision, mode, committed viewport, and media generation.
- `state`: managed page projection.
- `rtc-offer` and `rtc-candidate`: authenticated WebRTC signaling.
- `media-route`: `webrtc-direct`, `jpeg-fallback`, or `unavailable`, with a bounded reason code.
- `frame`: a versioned JPEG frame carrying sequence, revision, media generation, CSS viewport, encoded size, and bytes.

One control connection owns a Browser Tab presentation. A newer connection replaces the old connection, closes the old peer, and cancels its media work before accepting layout proposals.

## Input model

The client maps pointer, touch, wheel, annotation, and IME coordinates from the displayed surface into the currently presented `committedViewport`. Every input message names that layout revision. The Host accepts input only for its current revision and returns a bounded stale-layout result otherwise.

Move and wheel coalescing remains client-side. A pending layout switch pauses new input rather than guessing coordinates across a page reflow. Keyboard and IME input retain their current document focus behavior.

## Direct WebRTC media

Each visible Browser Tab may own one Sidebar-managed RTCPeerConnection. Signaling rides the authenticated control WebSocket. The media peer does not reuse the DSH Mobile Pairing peer because that peer is absent on desktop, may remain on a tunnel route, and has an independent lifecycle.

ICE is STUN-only. TURN URLs are rejected by Sidebar configuration. A configurable negotiation deadline bounds connection setup. Failure immediately selects JPEG fallback. Failed connections do not retry continuously; retry is permitted after a network-change signal, Tab reactivation, or explicit user action and is rate-limited by a configurable cooldown.

The client does not treat ICE connection as proof that video is usable. If autoplay, decode, or first-frame presentation fails, it sends an exact `media-decline`; the Host releases that attempt and resumes JPEG fallback. Retry remains available when no client peer was created, such as Host capacity fallback.

The media connection carries video only. It never requests camera or microphone permission. Closing or replacing the control connection, hiding or closing the Tab, disposing the session, or unloading the plugin closes the peer and its encoder resources.

## Chromium encoder page

The preferred encoder uses a separate, non-user-visible Page owned by the managed Chromium context:

1. CDP change events schedule a bounded capture from the target Page.
2. The Host captures the committed viewport and transfers the image to the encoder Page.
3. The encoder Page paints into a fixed Canvas for the current media generation.
4. Chromium's own media stack captures the Canvas and supplies a WebRTC video track.
5. Node relays signaling between the encoder Page and the authenticated client.

The encoder Page and target Page use separate origins and execution environments. No script, media primitive, or signaling state is injected into the browsed site. There is at most one capture, one queued latest dirty state, and one encoder Page per active media owner.

This approach avoids a Node native libwebrtc dependency and external FFmpeg/GStreamer processes. It is gated by a feasibility spike proving that headless Chromium can encode the Canvas track, desktop Chrome and Android WebView can receive it, viewport changes can force a timely keyframe, and a ten-minute run has bounded CPU and memory. Failure of that spike reopens the encoder choice; it does not permit an unverified native dependency.

## JPEG fallback

JPEG fallback is an interaction-first remote page, not continuous animation streaming. It sends a new frame after navigation, click, input, wheel, explicit refresh, or a significant page dirty event, subject to a configured low frame-rate ceiling. A static animation alone does not create an unbounded stream through the Mobile tunnel.

The Host retains at most one capture, one delivered unacknowledged frame, and one latest dirty request. JPEG frames include layout revision and media generation. The client paints and then acknowledges a valid frame, acknowledges a decodable protocol frame whose image fails, and never advances flow control for stale, future, or duplicate acknowledgements.

Origin-less Mobile tunnel connections use a conservative raw-JPEG ceiling. The tunnel encodes a Sidebar JSON Base64 frame inside another Base64 `ws-msg`; raw bytes therefore expand by approximately 16/9 before envelopes and encryption. A default ceiling near 96 KiB keeps the resulting plaintext safely below the existing 200 KiB limit. The exact ceiling is configurable and validated against the tunnel envelope in tests.

If an image exceeds its route budget, the Host reduces JPEG quality and encoded resolution while retaining the same CSS viewport. It never reduces `committedViewport` to fit a transport budget. If the minimum display profile still exceeds the budget, the Host retains the last good frame and reports a bounded degraded-media status. Evidence capture is separate from this path.

## Browser evidence

Browser annotation evidence continues to capture the exact committed viewport and current DOM/accessibility boxes from the target Page. It does not reuse a video frame or low-quality fallback frame. Evidence uses the committed layout revision and document identity so a stale selection cannot be attached to a reflowed or navigated document.

Mobile evidence transfer requires a bounded, explicit mechanism compatible with the existing tunnel body/chunk limits. It must not weaken the realtime fallback ceiling or silently send an oversized WebSocket frame.

## Resource ownership and lifecycle

An adapter-owned Browser media registry tracks every control connection, peer, encoder Page, timer, capture, pending layout proposal, and fallback frame. Ownership is keyed by Browser Tab and exact connection generation.

- A new control owner disposes the previous owner before starting media.
- Tab hide stops active capture and direct video after a configurable grace interval while preserving the target Page.
- Tab close closes target and encoder resources.
- Session disposal closes every resource for that session.
- Plugin disposal closes all peers, Pages, sockets, timers, and captures and waits for bounded safe points.
- Failed capture, encoder, or signaling operations release their exact generation and cannot affect a replacement connection.

Capacity is bounded by existing managed-page limits plus explicit limits for active media peers and encoder Pages. Capacity pressure first removes hidden or fallback peers; it does not evict an active target Page without using the existing Browser page policy.

## Security

- Browser stream tickets remain single-use, short-lived, and scoped to one Tab.
- WebRTC signaling is accepted only after control-protocol authentication.
- The authenticated signaling channel binds the DTLS fingerprint to the authorized client.
- TURN configuration is rejected.
- No camera, microphone, clipboard, filesystem, or target-page script privilege is granted to media code.
- The encoder Page cannot navigate to the target origin or expose target cookies/storage.
- ICE candidates are visible only to the authenticated owner of the Host.
- Fallback bytes continue to inherit Mobile tunnel sealing when that route is active.

## Configuration

All deployment-varying values are validated `managedBrowser` configuration. The design requires configuration for:

- adaptive layout settle interval and jitter hysteresis;
- layout dimension limits;
- preferred media route;
- STUN URLs;
- WebRTC negotiation timeout and retry cooldown;
- maximum active media peers and encoder Pages;
- direct-video frame rate and bitrate targets;
- desktop and Mobile JPEG quality, frame-rate, scale, and raw-byte ceilings;
- hide grace period and media idle timeout.

Defaults are defined with the implementation plan after the feasibility measurements. A diagnostic `jpeg-only` mode is permitted; production does not expose a no-fallback mode by default.

## Repository responsibilities

### `dsh-codex-sidebar`

- Browser control protocol v2.
- Authoritative layout state and revision checks.
- Input mapping and stale-layout handling.
- WebRTC signaling and encoder Page ownership.
- Bounded JPEG fallback and evidence integration.
- Route state, metrics, tests, ADR, README, and configuration documentation.

### `dsh-mobile` and `dsh-mobile-pairing`

- Verify Android WebView support for the protocol-v2 client and direct video receive path.
- Verify the current tunnel WebSocket facade preserves signaling and bounded fallback frames.
- Add only generic transport capability or error projection if the existing facade lacks it.
- Document the tightly bounded Browser fallback exception to the normal no-image tunnel policy.
- Do not implement a second Browser, expose Pairing peer internals, or make Sidebar depend on Pairing state.

### DSH Core

No changes. Missing public seams are documented in the plugin and the affected mode degrades or remains disabled on a clean official release.

## Observability

The Browser UI exposes a compact route state: direct video, low-bandwidth fallback, reconnecting, or unavailable. It does not expose raw ICE or network internals by default.

Host diagnostics record bounded counters and gauges without page URLs or content:

- layout proposals, commits, rejected stale input, and dropped stale frames;
- current viewport revision and media generation;
- media route and negotiation result category;
- capture, encode, send, paint, and acknowledgement latency;
- encoded bytes, route budget drops, and fallback recaptures;
- active peers, encoder Pages, captures, sockets, and timers.

## Verification

### Deterministic geometry regression

The primary regression drives a committed 1280 x 800 viewport while injecting alternating screencast device dimensions, page scale factors, delayed frames, and encoded sizes. Chromium viewport, Canvas surface policy, and input mapping remain on one revision. No injected media dimension can create a layout proposal or presentation resize.

Additional automated coverage includes:

- one hundred ResizeObserver jitter events produce at most one settled fit commit;
- continuous Sidebar drag produces local scaling and one final remote resize;
- stale/future layout commits, frames, acknowledgements, candidates, and generations are ignored;
- fixed presets never consume container resize proposals;
- Mobile IME open/close does not resize Chromium;
- orientation change commits once after settlement;
- the first new-generation frame causes one atomic switch without a black frame;
- input is never dispatched against a different Host revision;
- WebRTC timeout and peer failure select fallback without interrupting control;
- fallback raw frames remain below the double-Base64 tunnel envelope limit;
- close, reconnect, session disposal, and plugin disposal restore every resource count to baseline.

### Feasibility and integration gates

1. Chromium encoder spike: real headless Chromium to desktop Chrome, ten minutes, bounded CPU/RSS, keyframe after resize.
2. Android receive spike: physical Android WebView over IPv6/direct-capable network.
3. Tunnel fallback: physical Android on a route forced to Tunnel, stable click/type/scroll at low frame rate and no frame-limit close.
4. Desktop remote: browser outside the Host LAN, direct WebRTC when reachable and automatic JPEG fallback otherwise.
5. Evidence: annotation screenshot and DOM locator remain exact in every route.

### Lab acceptance

- No visible resizing for fixed or fit mode during a ten-minute dynamic-page run.
- Pointer and touch coordinates remain correct before and after every committed resize.
- One outstanding fallback frame and one capture at all times.
- Direct media disconnect changes route without losing page or input control.
- Tunnel fallback stays within its configured byte rate and never exceeds a 200 KiB plaintext frame.
- Repeated Tab open/close, Mobile background/foreground, and plugin reload return peers, Pages, tasks, RSS, and sockets to baseline.
- Production remains untouched until every gate passes on 3082 and physical Mobile.

## Delivery sequence

The final feature contains authoritative geometry and direct media, but implementation uses independent verification gates:

1. Capture the current oscillation as a red-capable trace and deterministic regression.
2. Implement protocol-v2 layout authority and prove stable JPEG presentation.
3. Complete the Chromium encoder feasibility spike.
4. Add WebRTC negotiation, direct media, and lifecycle cleanup.
5. Add and budget interaction-first JPEG fallback.
6. Validate desktop remote, Android direct, and Android tunnel routes.
7. Update Sidebar and Mobile decisions and operator documentation.
8. Release through isolated tags and 3082 acceptance before any production promotion.

This sequence isolates failures without creating two product architectures. Every stage uses the same control protocol and layout model.

## Alternatives rejected

- **Direct iframe:** blocked by common framing policies and cannot provide the shared automation/evidence semantics.
- **External browser Tab:** violates the in-Sidebar Browser requirement.
- **Desktop client or native WebView:** creates a separate platform product and maintenance surface.
- **Fixed viewport only:** stable but wastes available space and does not satisfy adaptive desktop and Mobile use.
- **WebRTC without layout revision:** changes transport while preserving the resize defect.
- **TURN-backed guaranteed video:** conflicts with the selected operability-first product target and introduces media-relay operations.
- **Video over the existing Mobile tunnel:** exceeds the current relay budget and competes with control traffic.
- **Node native libwebrtc or FFmpeg as the first encoder:** adds cross-platform binary/process maintenance before Chromium's built-in encoder path is disproved.
