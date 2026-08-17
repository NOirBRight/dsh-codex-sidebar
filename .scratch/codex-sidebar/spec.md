# DSH Codex-style 侧栏

Status: ready-for-agent

Glossary: `CONTEXT.md`. Decisions: `docs/adr/0001`–`0017`. Visual: `.scratch/codex-sidebar/prototype/DSH Codex Sidebar Prototype v2.html`.

## Problem Statement

I work in a DeepSeek Harness 主会话. The agent writes files, starts pages, and leaves diffs, but I have to leave the conversation to inspect them. I want a Codex-app-style right-hand 侧栏 on this 主会话: Review, Terminal, Browser (with 批注), Files, and a Side Chat that can ask about the work without interrupting the 舵主 — and that can 投递 to another 主会话 when the work is not this one.

## Solution

A DSH Web plugin that attaches a tabbed 侧栏 to the current 主会话. The human picks a 工具 from a Palette inside an empty Tab; more Tabs open with `+`. The 侧栏 can collapse behind a 侧栏开关 and reopen with the same Tab strip. Clicking a file or URL in the 主会话 (or a 工具 shortcut) expands the 侧栏 and opens or reuses the right Tab.

The five 工具s inspect and support the 主会话. They do not replace it: Files and Review are read-only, Browser does not start the project, Terminal is the human's pty, Side Chat is a frozen Fork that answers in its own Tab and 投递s with a labeled identity.

## User Stories

1. As a DSH user, I want a 侧栏 on the current 主会话, so that I can inspect the 舵主's work without leaving the conversation.
2. As a DSH user, I want the 舵主 to remain the left-hand 主会话, so that the 侧栏 never becomes a second host.
3. As a DSH user, I want an empty Tab to show a Palette of Review, Terminal, Browser, Files, and Side Chat, so that I can choose a 工具 the way Codex App does.
4. As a DSH user, I want choosing a 工具 to dismiss the Palette and fill that Tab, so that I see the tool, not a permanent five-item rail.
5. As a DSH user, I want a `+` control that opens a new empty Tab with the same Palette, so that I can run more than one 工具 at once.
6. As a DSH user, I want more than one Tab of the same 工具, so that I can keep two Browsers or two Terminals without them overwriting each other.
7. As a DSH user, I want each 主会话 to have its own Tab strip, so that switching conversations does not mix workspaces.
8. As a DSH user, I want the Tab strip to come back when I reopen the same 主会话, so that I do not rebuild the 侧栏 every time.
9. As a DSH user, I want a 侧栏开关 at the top, like Codex, so that I can hide the 侧栏 when I need the conversation full width.
10. As a DSH user, I want closing the last Tab to collapse the 侧栏, so that I am not left with an empty Palette occupying the right side.
11. As a DSH user, I want collapsing the 侧栏 to keep the Tab strip, so that showing it again restores what I had.
12. As a DSH user, I want clicking a file path in the 主会话 to expand the 侧栏 and open Files, so that "the 舵主 just wrote this" is one click from preview.
13. As a DSH user, I want clicking an http(s) URL in the 主会话 to expand the 侧栏 and open Browser, so that a page the 舵主 created is one click from view and 批注.
14. As a DSH user, I want a 工具 shortcut to expand the 侧栏 and open that 工具, so that I am not blocked when the 侧栏 is hidden.
15. As a DSH user, I want picking from the Palette while the 侧栏 is hidden to expand it, so that starting a 工具 always shows the work surface.
16. As a DSH user, I want clicking a path that is already open to focus that Tab instead of opening another, so that I do not collect ten `Login.tsx` Tabs.
17. As a DSH user, I want clicking a URL that is already open to focus that Browser Tab, so that refresh and 批注 stay on the same page.
18. As a DSH user, I want a different path or URL to open a new Tab of that 工具, so that I can compare two files or two pages.
19. As a DSH user, I want Review to open on 本轮变更, so that I first see what the 舵主 just did, not last week's uncommitted notes.
20. As a DSH user, I want to switch Review to the full working tree, so that I can also see human edits the 舵主 did not make.
21. As a DSH user, I want Review to be read-only, so that I do not stage, revert, or commit from the 侧栏 and race the 舵主.
22. As a DSH user, I want to send a Review finding into the 主会话 composer, so that restoring a deleted function is the 舵主's job.
23. As a DSH user, I want Files to show the 主会话 workspace tree, so that I can find what the 舵主 wrote.
24. As a DSH user, I want Files to preview text, Markdown, images, and code without letting me save edits, so that the 侧栏 is not a second IDE.
25. As a DSH user, I want to put a 批注 on a file preview, so that I can point the 舵主 at a specific mark instead of describing it in prose.
26. As a DSH user, I want Browser to load a URL I type or a link from the 主会话, so that I can see the page the 舵主 created.
27. As a DSH user, I want Browser to 批注 elements on that page, so that I can say "make this button red" against the real UI.
28. As a DSH user, I want Browser not to start or stop the project, so that the plugin never guesses `npm run dev`.
29. As a DSH user, I want a dead localhost URL to show as unreachable, so that I know I must ask the 舵主 or use Terminal to start the page.
30. As a DSH user, I want to ask the 舵主 (or 投递) to start the page when I do not know the command, so that starting stays the 主会话's job.
31. As a DSH user, I want a Terminal Tab to be my own pty in the 主会话 cwd, so that I can run tests beside the conversation.
32. As a DSH user, I want each Terminal Tab to have its own pty, so that two shells do not share stdin.
33. As a DSH user, I want the 舵主 to keep using its own command tools, so that my typing never enters the agent's tool loop.
34. As a DSH user, I want Terminal output not to be injected into the 主会话, so that `ls` does not interrupt the 舵主.
35. As a DSH user, I want a Terminal to die when I close its Tab, so that hidden shells do not keep running after I am done.
36. As a DSH user, I want a Terminal to reconnect on 主会话 reopen when possible, so that a long-running human command survives a refresh.
37. As a DSH user, I want Enter on a 批注 to stack it on the 主会话 composer as an attachment, so that I can pile two marks and send once.
38. As a DSH user, I want Ctrl+Enter on a 批注 to send it to the 主会话 immediately, so that a single mark can go out without extra clicks.
39. As a DSH user, I want stacked 批注 to send when I click send on the 主会话 composer, so that attachments behave like ordinary chat extras.
40. As a DSH user, I want a busy 主会话 to queue 批注 the same way it queues a normal message, so that I do not interrupt the current turn.
41. As a DSH user, I want 批注 to land on the 主会话 composer even if Side Chat is focused, so that marks remain instructions to the 舵主.
42. As a DSH user, I want to open Side Chat and ask questions while the 主会话 is Working, so that I do not derail the 舵主's turn.
43. As a DSH user, I want Side Chat to Fork the 主会话 at the first send, not when the Tab opens, so that idle Tabs do not freeze a stale world.
44. As a DSH user, I want that Fork to include completed turns plus the in-flight tool trace, so that I can ask about what this turn is already doing.
45. As a DSH user, I want the Fork to omit an unfinished final reply, so that a half-written conclusion is not treated as decided.
46. As a DSH user, I want the Fork to stay frozen while I ask several follow-ups about that moment, so that the 舵主 moving on does not cut my questions off.
47. As a DSH user, I want a new Side Chat Tab to be a new Fork, so that "ask about now" is a fresh Tab, not a rewrite of the old conversation.
48. As a DSH user, I want Side Chat to 察看 the 主会话 when it needs "now", so that progress is a pull, not an automatic delta on every turn.
49. As a DSH user, I want 察看 to return a 进度卡片 (turn/step, busy or idle, last visible conclusion, 本轮变更 file list), so that an eight-turn run does not dump a log into Side Chat.
50. As a DSH user, I want Side Chat to read files and search the workspace, so that it can verify a 进度卡片 against the actual tree.
51. As a DSH user, I want Side Chat to refuse write, Terminal, and spawn, so that only the 舵主 changes the world.
52. As a DSH user, I want to say "the one doing the login work" and have Side Chat 列出 主会话s, so that I do not have to know a session id.
53. As a DSH user, I want 列出 to cover every unarchived 主会话 in this DSH Web profile, including other workspaces, so that cross-repo work is findable.
54. As a DSH user, I want 列出 to omit subagents and other Side Chats, so that "that agent" always means a 舵主 I can 投递 to.
55. As a DSH user, I want to 察看 a listed 主会话 before 投递, so that I do not instruct a busy 舵主 blindly.
56. As a DSH user, I want to 投递 a message to another 主会话, so that Side Chat can talk to a 舵主 that is not the current one.
57. As a DSH user, I want a 投递 to appear as a labeled card naming the source Side Chat and source 主会话, so that the receiving 舵主 does not treat it as me typing.
58. As a DSH user, I want a 投递 into a busy 主会话 to queue like ordinary chat, so that it does not steal the current turn.
59. As a DSH user, I want to 投递 to the current 主会话 as well, so that Side Chat can hand a conclusion back to the 舵主 it Forked.
60. As a DSH user, I want Side Chat's own transcript to stay in its Tab, so that side questions do not pollute the 主会话 history.
61. As a DSH user, I want two Side Chat Tabs on the same 主会话 to keep independent Forks and transcripts, so that two lines of questioning do not share a freeze point.
62. As a DSH user, I want the 侧栏 on session B not to show session A's Tabs, so that two 舵主s never share a work surface.
63. As a DSH user, I want archived 主会话s out of 列出, so that "the one doing X" cannot resolve to a dead conversation.
64. As a DSH user, I want a Side Chat that has not sent a message yet to have no Fork, so that opening the Tab is free.
65. As a DSH user, I want 察看 of the attached 主会话 not to unfreeze the Fork, so that the baseline for my questions stays the first send.
66. As a DSH user, I want 本轮变更 in Review and in a 进度卡片 to mean the same thing, so that "what just changed" is one concept.
67. As a DSH user, I want Files 批注 and Browser 批注 to use the same Enter / Ctrl+Enter rules, so that I do not learn two composers.
68. As a DSH user, I want a collapsed 侧栏 to still receive a queued Tab from a click, so that the first thing I see when it expands is the file or page I clicked.
69. As a DSH user, I want to close a middle Tab without collapsing the 侧栏, so that only the last Tab hides the work surface.
70. As a DSH user, I want the Palette to list only the five 工具s, so that the 侧栏 does not grow a plugin marketplace in this spec.
71. As a DSH user, I want Side Chat not to spawn subagents, so that new workers only come from a 舵主.
72. As a DSH user, I want Side Chat not to address subagents, so that instructions cannot bypass the 舵主.
73. As a DSH user, I want Browser to leave project logs in Terminal or the 主会话, so that the preview 工具 does not grow a hidden process manager.
74. As a DSH user, I want Review of 本轮变更 to stay empty when the 舵主 has not written files this turn, so that I am not shown an unrelated working tree by default.
75. As a DSH user, I want a file click from the 主会话 to open Files even if Browser is the active Tab, so that paths and URLs keep their own 工具s.
76. As a DSH user, I want a URL click to open Browser even if Files is the active Tab, so that pages are not forced into the file previewer.
77. As a DSH user, I want the 侧栏开关 to hide and show without destroying Tabs, so that hide is not delete.
78. As a DSH user, I want a 投递 I sent from Side Chat not to be treated as a 批注, so that conversation handoff and preview marks stay different objects.
79. As a DSH user, I want Side Chat file reads to see the live workspace, so that 察看 plus read can check the 舵主's latest files even though the Fork is frozen.
80. As a DSH user, I want a failed 投递 (unknown 主会话, archived, or rejected source) to stay visible in Side Chat, so that I know the other 舵主 never saw it.

## Implementation Decisions

- Ship as a DeepSeek Harness Web Cordis plugin with a host half and a client half, attached to the current 主会话 — not a standalone app.
- One host-side `SidebarSession` per 主会话 owns Tab strip, collapse flag, Fork cursor, 批注 draft targeting the 主会话 composer, and Side Chat transcripts. The client renders that state and sends intents.
- Persist `SidebarSession` with the 主会话 identity (Tab strip, collapse, Side Chat transcripts and Fork seq, Terminal reconnect tokens). A different 主会话 loads a different `SidebarSession`.
- Palette → fill Tab; `+` inserts an empty Tab; Tab identity includes 工具 plus target (path or URL) for reuse.
- Closing the last Tab sets collapsed; 侧栏开关 toggles collapsed; click/shortcut/Palette also sets expanded and selects or creates the Tab.
- Review reads 本轮变更 from the 主会话 log (tool writes in the current or latest unfinished turn). Working-tree mode reads git status/diff from the 主会话 cwd. No git write APIs.
- Files lists and reads the 主会话 cwd. Preview is read-only. 批注 records a target (path, optional range) and text.
- Browser is a navigable page view plus 批注 (selector/snapshot). No subprocess, no project-type detection, no run/stop. Link takeover in the 主会话 transcript sends an open-URL or open-path intent.
- Terminal is a human pty per Tab, cwd = 主会话 workspace. The 主会话 agent does not attach to this pty. Output is not injected. Close Tab destroys the pty; reopen may replay/reconnect if the host still holds it.
- 批注 Enter appends an attachment on the 主会话 composer; Ctrl+Enter or composer send enqueues those attachments as a user turn on that 主会话, using the same busy-queue as ordinary chat. Side Chat focus does not change the destination.
- Side Chat first send: copy 主会话 derived messages through last complete turn plus in-flight tool/call and tool/result events; omit an unclosed assistant final. Store Fork seq. Later sends do not rewrite that prefix.
- 察看 is a Side Chat tool: given a 主会话 id, return a 进度卡片 built from that session's log (turn/step, busy/idle, last visible assistant conclusion, 本轮变更 paths). It does not append the log into the Fork.
- 列出 uses the profile's 主会话 roster (unarchived, any cwd), filterable by the human phrase (title/id/cwd). Exclude subagents and Side Chat Tabs.
- 投递 enqueues on the target 主会话 inbox as a sourced message (not human user-role). The client shows a labeled card. Busy target uses the same queue as chat. Source identity includes Side Chat Tab and originating 主会话.
- Side Chat tools: read/search workspace; 列出; 察看; 投递. No write, no pty, no spawn.
- Start-the-page is not a Browser effect: the human asks the 主会话, 投递s "start the page", or types in Terminal.
- Donor UIs (existing DSH preview/review/file panels) may be copied for rendering, but they must obey these rules (no project runner, no in-panel edit, no git writes).
- Chrome (Palette, Tab strip, 侧栏开关, empty states, Terminal) uses the DSH host theme. Codex App is IA, not a light-panel paint. See ADR 0016.
- 批注: pencil enters the tool; the composer appears only after a content click, at that mark, and moves with later clicks. Unreachable/empty Browser has no 批注 icon. See ADR 0017.
- Visual source of truth is the signed-off v2 prototype. Do not copy v1 interaction-dump styling into the plugin.

## Testing Decisions

A good test drives one 工具 seam: given fixtures, dispatch that 工具's intents, and assert its view model plus effects. Tests must not open React, a live browser, or a live DSH process. They must not assert CSS or production file paths. Ports (session log, roster, filesystem, pty, git diff, page fetch) are fakes.

There are five product seams — one per 工具. Palette / Tab strip / 侧栏开关 / collapse-on-last-close / expand-on-click are a **shared chrome fixture**, not a sixth seam. Each 工具 test may dispatch chrome intents that are preconditions for that 工具 (for example Files tests include path-click expand and reuse).

1. **Review** — fixtures: 主会话 write events for 本轮变更, fake git working tree. Intents: open, switch 本轮变更/working tree, send a finding to the 主会话 composer. Assert: default is 本轮变更, switch works, no git write effects, finding is a composer attachment/send.

2. **Files** — fixtures: workspace tree and file bytes. Intents: open path (reuse by path), select node, 批注 Enter / Ctrl+Enter. Assert: preview is read-only (no save effect), 批注 lands on the 主会话 composer, same path reuses a Tab.

3. **Browser** — fixtures: page documents and an unreachable URL. Intents: open URL (reuse by URL), navigate, 批注 Enter / Ctrl+Enter, attempt run. Assert: no run/stop/spawn effect, unreachable state, 批注 uses the same composer rules as Files, same URL reuses a Tab.

4. **Terminal** — fixtures: a pty port. Intents: open Tab, write, close Tab, reopen 主会话. Assert: one pty per Tab, close destroys it, cwd is the 主会话 workspace, no inject into the 主会话 inbox, 舵主 commands do not share this pty.

5. **Side Chat** — fixtures: 主会话 log with seq (including an in-flight turn), roster of unarchived 主会话s across cwds, plus a subagent that must not appear. Intents: first send (Fork), follow-up send, 列出, 察看, 投递, read file, write/spawn. Assert: Fork at first send then freeze, 进度卡片 shape, 列出 is profile-wide 主会话s only, 投递 is sourced not user-role, read allowed, write/spawn rejected.

Prior art: none in this repo yet (greenfield). Signed-off visual prototype (throwaway, IA + look): `.scratch/codex-sidebar/prototype/DSH Codex Sidebar Prototype v2.html`. v1 (`DSH Codex Sidebar Prototype.html`) is the interaction dump only.

## Out of Scope

- Starting or stopping the project from Browser
- Side Chat automatic incremental inject, timer expiry, or forced "open a new Side Chat"
- Spawning subagents; listing or 投递ing to subagents or other Side Chats
- In-panel file editing, Review stage/revert/commit, Terminal sharing stdin with the 舵主, auto-injecting Terminal output
- Pixel-perfect Codex App chrome, Codex CLI `/side` semantics, a standalone host
- Marketplace / third-party 工具 registration
- Mobile layout, multi-window, and non-Web DSH profiles

## Further Notes

Vocabulary is `CONTEXT.md`. If an implementation name drifts toward "sidebar / mode / preview runner / user message for 投递", it is wrong.

This spec is the product contract from the grilling session. Implementation tickets should slice along the five 工具 seams, not along visual panels copied from other plugins. Chrome (Palette / Tab / 侧栏开关) is shared fixture code, not its own ticket stream.
