# 批注: human surface vs agent evidence

A 批注 still instructs the 主会话. After Send, the human-visible user bubble is only the note text (or captions when the notes are empty) plus numbered chips. Locator strings, file snippets, and Browser screenshots are model-facing evidence attached to the same `user/message` at `agent/pre-step`, recorded on `source.annotations`.

`agent.inject()` was rejected: a running 主会话 would claim next-step context on the current turn, so queued 批注 would not travel with their user message (ADR 0003). Staging is bound to the next user-kind inbox insert for that session id.

Clicking a transcript chip dispatches `reveal-mark`: the 侧栏 opens the Files/Browser/Review mark without returning it to the composer stack. Sent marks remain in `deliveredMarks` so the preview can keep its numbered highlight.
