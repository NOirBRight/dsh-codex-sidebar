# Review is a read-only diff

Review shows 本轮变更 by default and can switch to the working tree. The human does not stage, revert, or commit there. Asking the 主会话 to restore a deletion is done in the 主会话 composer (or by sending a hunk into it).

A hunk-level rollback or a mini Git GUI was rejected: the 侧栏 would race the 舵主 on the working tree.
