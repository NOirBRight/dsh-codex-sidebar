# Prototype (throwaway, signed off)

Visual and IA reference for the plugin. Not production.

```bash
xdg-open ".scratch/codex-sidebar/prototype/DSH Codex Sidebar Prototype v2.html"
```

| File | Role |
|---|---|
| `DSH Codex Sidebar Prototype v2.html` | **Source of truth.** Signed off 2026-08-17. Copy look and clicks from here. |
| `DSH Codex Sidebar Prototype.html` | v1 interaction dump. Do not copy its styling. |

Product contract is still `.scratch/codex-sidebar/spec.md` and `docs/adr/0001`–`0017`. This HTML is how those rules should feel.

What v2 froze on top of the spec:

- Chrome follows the DSH host theme (ADR 0016). Toggle in the 主会话 topbar is prototype-only.
- Palette, Tab strip, Browser empty (“Start browsing”), Side Chat empty (icon + title + one line, Codex-shaped composer) match Codex App IA with this product’s copy.
- Files: preview left, tree right, tree closable (Cursor layout).
- Review: Uncommitted list, expand unified diff, gutter `+`.
- 批注 composer appears after a content click, at the mark (ADR 0017).
- Terminal fills the pane and follows theme.
- 侧栏开关 is the top icon; last Tab close collapses the whole 侧栏.
- `列出` / `察看` live in Side Chat’s `+`, not as a resident toolbar.
