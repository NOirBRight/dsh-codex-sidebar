# 批注: Add stacks, Send sends the current mark

A 批注 is not a Side Chat turn. **Add** saves it to the 主会话 composer as a stackable attachment (Codex's "N annotations" chip). **Send** immediately sends only the mark currently being edited; previously stacked marks stay in the composer. Enter is an Add shortcut and has no Ctrl/Meta variant. If the 主会话 is busy, Send queues exactly like an ordinary user message.

The resident composer primary Send button is submit-ready whenever stacked marks exist, so it sends all of them even when the visible draft is empty. The sidebar strip keeps its own equivalent send action. Clicking a numbered mark or chip reopens it for editing; Add updates it in place, Send sends only it, and Delete removes it.

Sending 批注 into Side Chat, auto-firing every mark, or merging earlier stacked marks into a direct single-mark Send was rejected: 批注 is an instruction to the 主会话 that is doing the work, and the two send scopes must remain explicit.
