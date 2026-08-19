# 批注 composer appears at the mark, after selection

The visible pencil enters 批注. The composer is not a resident bar. It appears after the human selects previewed content (a file line, Markdown text range, image point, or page element), next to that mark, and moves if they select another. Esc dismisses it. Add stacks or updates the mark; Send sends only the current mark (ADR 0003).

Saved marks retain their highlight and numbered indicator. Code and diff marks are anchored to source lines; Markdown text selections are captured reliably on mouse release as a blue bounding rectangle plus an opaque red Custom Highlight for the exact text range, while image clicks use a point rectangle in the scrollable file surface, so their indicators move with the selected content instead of collecting at the preview origin. Clicking an indicator or either copy of its composer chip reopens the same mark for editing, including a Delete action. A legacy surface mark without a rectangle remains available from its chip and can be re-anchored by reopening it, selecting the intended content, and choosing Add.

A dock that shows as soon as 批注 is on, or that stays pinned to the pane bottom, was rejected. Browser 批注 is only offered when a page is actually loaded — not on empty or unreachable chrome.
