# 投递 is not a user message

When Side Chat sends to another 主会话 (or the current one), the payload is a 投递: a labeled card in the receiver's transcript that names the source Side Chat and source 主会话. The receiving model sees a sourced 投递, not a user-role prompt from the human.

A bare user-role prompt was rejected because the 舵主 would obey it as the operator. Hiding the 投递 from the human was rejected because they could not audit it. The receiving 主会话 still queues a busy 投递 the same way it queues ordinary chat.
