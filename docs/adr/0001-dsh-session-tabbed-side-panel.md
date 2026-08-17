# Attach to a DSH 主会话 as a tabbed 侧栏

The product is a DeepSeek Harness web plugin, not a standalone host. It hangs off one 主会话: the human keeps talking in the center, and the right 侧栏 is a Codex-app-style tab strip (empty Tab → Palette → filled 工具; `+` opens another Tab).

A persistent five-item mode rail was rejected because Codex App (the reference) uses tabs, and Review / Browser / Terminal need to coexist. Treating any other runtime as the host was rejected: every 工具 serves the DSH 主会话 the 侧栏 is attached to.

Tabs persist with that 主会话 (reopen the session, tabs return; a different session has its own strip). Multiple Tabs of the same 工具 are allowed. Clicking a file path or URL reuses a Tab already showing that target; otherwise it opens a new Tab.
