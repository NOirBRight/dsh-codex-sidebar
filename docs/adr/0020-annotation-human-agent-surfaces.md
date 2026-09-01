# 批注: human surface vs agent evidence

A 批注 still instructs the 主会话. After Send, the human-visible user bubble is only the note text (or captions when the notes are empty) plus numbered chips. Locator strings, file snippets, and Browser screenshots are model-facing evidence attached to the same `user/message` at `agent/pre-step`, recorded on `source.annotations`.

`agent.inject()` was rejected: a running 主会话 would claim next-step context on the current turn, so queued 批注 would not travel with their user message (ADR 0003). Staging is bound to the next user-kind inbox insert for that session id.

On DSH `0.1.2-alpha.1`, stacked chips occupy the official `conversation.input.dock` slot and use only its public `InputState` / `InputActions`. A chip is not published to that composer until its Host evidence batch has finished staging. When no visible draft or image exists, the dock writes one zero-width sentinel through `InputActions.setDraft`; the official submit path accepts it, and the Host removes it before the enriched message reaches transcript or model views. The Alpha Session lifecycle snapshot contains no message history, so sent chips are retired from the binding's exact appended direct-user `user/message` event, not by inspecting private composer DOM or guessing from lifecycle bits.

Do not shadow `conversation.chat.node` for `user`/`steering`. That slot is keyed, so a custom renderer would replace the official bubble. The stock bubble stays; numbered chips paint under it from `source.annotations` via the same overlay pattern as tool-row +/−. Clicking a chip still dispatches `reveal-mark`.
