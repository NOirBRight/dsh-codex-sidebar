# Terminal is the human's pty, not the 主会话's

Each Terminal Tab is a human shell in the attached 主会话's cwd. The 主会话 keeps using its own command tools. Terminal output is not auto-injected into the 主会话.

Sharing one pty with the 舵主 was rejected: they would fight over stdin. Injecting every command's output was rejected: that interrupts the 主会话 with noise.
