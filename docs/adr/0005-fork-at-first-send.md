# Fork at first send, not when the Tab opens

A Side Chat Tab can sit empty. The Fork is cut when the human sends the first Side Chat message, and it includes the 主会话's completed turns plus the in-flight tool trace, not an unfinished final reply.

Forking at tab-open was rejected: opening Browser then later Side Chat would freeze a world the 主会话 has already left.
