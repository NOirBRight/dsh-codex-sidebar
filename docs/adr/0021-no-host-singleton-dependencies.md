# Do not depend on DSH host singleton packages

Never put `@deepseek-ai/dsh-tools` (or other host-shared singletons) in `dependencies`.

The Web loader resolves from the profile first (`~/.dsh/profiles/web/node_modules`), then the installer fallback symlink. A published dependency is hoisted into the profile. `dsh-base` then loads that copy of ToolRuntime, while `dsh-agent-loop` still imports `TOOL_RUNTIME_SCHEDULER` from the host copy. Two ESM modules each `Symbol('@deepseek-ai/dsh-tools.scheduler')`, so `ctx.tools[hostSymbol]` is `undefined` and every tool call dies on `.prepare`.

This happens even if our source never imports the package. The lockfile entry is enough.

Take the host service with `ctx.inject(['tools'])`. Do not list it as a peer either unless the profile has `autoInstallPeers: false` forever — a peer can still be installed and hoisted.
v0.2.2 shipped this bug; v0.2.3 removed the dependency. Deleting the hoisted folder is not durable: the next `dsh plugin add` / `pnpm install` brings it back while the old dependency remains.
