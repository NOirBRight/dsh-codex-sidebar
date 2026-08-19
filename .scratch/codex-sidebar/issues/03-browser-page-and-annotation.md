# 03 — Browser: 打开页面并批注，不起项目

**What to build:** Clicking an http(s) URL in the 主会话 expands the 侧栏 and opens Browser. Typing a URL, back/forward/refresh, and open-external work. The same URL reuses a Tab; a different URL opens another. Empty state is “Start browsing”; a dead localhost shows unreachable. 批注 is offered only when a page is actually loaded, and uses the same composer rules as Files. Browser never starts, stops, or detects a project.

**Blocked by:** 01 — Files: 点路径就能预览和批注

**Status:** resolved

- [x] URL click / typed URL opens or reuses a Browser Tab; paths still go to Files, not this 工具
- [x] Empty chrome has no 批注 icon; unreachable has no 批注 icon; a loaded page can 批注 at the clicked element
- [x] Back, forward, refresh, and open-external exist; no run/stop/spawn effect when a URL fails
- [x] 批注 Enter / Ctrl+Enter land on the 主会话 composer, same rules as Files
- [x] Tests drive the Browser seam with fake page documents and an unreachable URL: reuse, navigate, no spawn, 批注 destination is the 主会话

## Accepted managed-browser follow-up

ADR 0019 replaces iframe/pick-proxy with one managed Chromium for every page. The accepted spike is `.scratch/managed-browser-live-prototype/`: binary 30 FPS screencast, scroll/drag input, 批注-time scrolling and recapture, and screenshot evidence. Productization preserves the five `browser_*` automation tools while moving them to the Host-managed Page.
