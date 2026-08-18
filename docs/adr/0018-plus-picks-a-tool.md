# + opens a 工具 menu, not an empty Tab

Clicking + in the Tab strip shows a dropdown of 工具. Choosing one opens a filled Tab. Creating an empty Tab and making the human pick from the Palette in the middle was rejected: one extra click and a flash of empty chrome.

The Palette remains for a 侧栏 with no filled Tab, and for any leftover empty Tab. `open-empty-tab` stays on the seam so tests and persisted empty Tabs still work.

The Tab strip hides its horizontal scrollbar. Overflowing Tabs scroll with the mouse wheel instead.
