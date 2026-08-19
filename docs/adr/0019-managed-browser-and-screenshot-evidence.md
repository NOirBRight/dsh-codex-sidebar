# Browser uses one managed Chromium and every Browser 批注 carries a screenshot

The Browser tool uses one Host-managed persistent Chromium profile for every http(s) page. The client renders the active Page through a bounded binary screencast and sends pointer, wheel, keyboard, and IME input back to that Page. Collapsing the 侧栏 stops frames, not the Page, so the 舵主 can still snapshot, click, and fill it.

iframe, pick-proxy, and a split embedded/managed policy were rejected. A page that merely permits framing still cannot guarantee DOM access, exact screenshots, or the same automation contract. One managed implementation gives local and external pages the same behavior.

Entering 批注 captures an exact viewport screenshot and visible DOM/a11y boxes from the same managed Page. Scrolling temporarily resumes the page; stopping captures a new immutable view. A Browser 批注 cannot be added without this evidence. One viewport image plus the target rect is sent with each Browser 批注; Files and Review remain text-only.

The accepted spike at `.scratch/managed-browser-live-prototype/` established the initial performance contract: binary WebSocket frames, 30 FPS cap, latest-frame backpressure, no per-frame Canvas resize, no per-input HTTP requests, draggable scrollbars, and scrolling while 批注 stays active. Its automated run measured a 16.8 ms p95 frame gap, zero Canvas resize mutations, and successful normal/批注 scroll interaction on the lab machine.

The existing `browser_tabs`, `browser_open`, `browser_snapshot`, `browser_click`, and `browser_fill` tool names remain. Their implementation moves from the client iframe DriveHub to the managed Page; refs become document-scoped and stale after navigation.
