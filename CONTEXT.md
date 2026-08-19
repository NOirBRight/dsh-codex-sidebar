# DSH Codex Sidebar

A tabbed side panel attached to one DeepSeek Harness 主会话. Its tools exist only to inspect and support that session's work.

## Language

**主会话**:
The DSH conversation this 侧栏 belongs to. Same object as that conversation's 主Agent / 舵主.
_Avoid_: host, thread, parent chat, 当前窗口, 左侧 Agent（当它被说成另一种东西时）

**Fork**:
The Side Chat's starting context: a copy of the 主会话 taken at the first Side Chat send. It stays frozen while the human keeps asking; the 主会话 moving on does not rewrite it.
_Avoid_: live share, sync, clone session, tab-open snapshot, 每问强行增量

**本轮变更**:
File edits produced by the 主会话's current or latest unfinished turn.
_Avoid_: working tree, uncommitted changes, patch set

**侧栏**:
The right-hand work surface of one 主会话. A 侧栏开关 shows or hides it; closing the last Tab hides it. Clicking a 主会话 file/URL or a 工具 shortcut shows it again. Hidden, it still keeps that 主会话's Tab strip.
_Avoid_: sidebar, rail, workbench, side panel, overlay

**侧栏开关**:
A control (Codex-style) that shows or hides the 侧栏.
_Avoid_: window close, destroy session

**Tab**:
One pane in the 侧栏. Clicking + opens a 工具 menu and choosing one creates a filled Tab. An empty Tab (if one exists) shows a Palette. Tabs belong to one 主会话, survive reopen of that 主会话, and more than one Tab may use the same 工具.
_Avoid_: page, pane, window, mode

**Palette**:
The picker shown inside an empty Tab, or when the 侧栏 has no Tab yet, listing the 工具. Choosing one dismisses the Palette and fills that Tab. The + control uses the same list as a dropdown so the human does not create an empty Tab first.
_Avoid_: command menu, mode list, launcher

**工具**:
What a filled Tab contains: Review, Terminal, Browser, Files, or Side Chat.
_Avoid_: mode, view, panel type

**Review**:
A 工具 that shows a read-only diff. Default is 本轮变更; the human can switch to the full working tree. It does not stage, revert, or commit.
_Avoid_: git GUI, PR review, code review agent

**Files**:
A 工具 that shows the 主会话 workspace tree and a read-only file preview. The human can 批注; they cannot save edits here.
_Avoid_: explorer, editor

**Terminal**:
A 工具 that is the human's shell in the 主会话 workspace. Each Terminal Tab has its own pty. It is not the 主会话's command tool, and its output is not injected into the 主会话.
_Avoid_: pty, console, agent shell

**Browser**:
A 工具 that shows a URL or local page, including 批注, and takes over http(s)/path links from the 主会话. It does not start or stop the project.
_Avoid_: preview, iframe, webview, project runner

**Side Chat**:
A 工具 whose Agent is a Fork of the 主会话. It answers in its own Tab without interrupting the 主会话, may read the workspace, cannot write / run a terminal / spawn, and may 投递 to other 主会话s.
_Avoid_: /side, subagent inspector, 侧聊, 子Agent 聊天, 第二条输入框

**批注**:
A mark a human puts on a previewed file or page by clicking that content, intended as guidance for the 主会话. The composer appears at the mark; it is not a resident bar. After Send, the 主会话 bubble shows the human note plus chips; locators and screenshots are evidence on that same user message, not dumped into the bubble.
_Avoid_: comment, highlight, annotation note, dock, floating input, inject-as-context

**投递**:
A message a Side Chat sends to a 主会话. In that 主会话 it appears as a labeled card naming the source Side Chat and source 主会话; the receiving model sees it as a sourced 投递, never as the human's user message.
_Avoid_: user message, inject-as-user, 转发, @mention

**察看**:
A read-only Side Chat action that returns a 进度卡片 for a 主会话. Used when the Side Chat must know "now" without unfreezing its Fork.
_Avoid_: 增量, follow, subscribe, live tail

**列出**:
A Side Chat action that returns unarchived 主会话s in this DSH Web profile (any workspace). The human's phrase filters the list. Subagents and other Side Chats are not listed.
_Avoid_: inspect whitelist, 投递目标白名单, spawn list, cwd-only roster
