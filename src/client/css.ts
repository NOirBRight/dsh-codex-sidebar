/** Host-theme chrome. Prototype IA; DSH tokens instead of a light Codex island. */

export const SIDEBAR_CSS = `
@font-face {
  font-family: 'DCS Terminal Graphics';
  src: local('Noto Sans Mono'), local('DejaVu Sans Mono');
  font-style: normal;
  font-weight: 400;
  unicode-range: U+2500-259F, U+1FB00-1FBFF;
}
:root {
  --dcs-toggle-size: 32px;
  --dcs-toggle-pad: 8px;
  --dcs-tabbar-height: calc(var(--dcs-toggle-size) + var(--dcs-toggle-pad) * 2);
}
.dcs-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: visible;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family);
  border-left: 1px solid var(--dsw-alias-border-l2);
}
.dcs-col {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
}
.dcs-col > .dcs-root {
  flex: 1;
  min-height: 0;
  height: auto;
}
.dcs-col[data-dragging],
.dcs-col[data-dragging] * { user-select: none; }
.dcs-col-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 4;
  width: 8px;
  margin-left: -4px;
  cursor: col-resize;
  touch-action: none;
}
.dcs-col-handle::after {
  content: '';
  box-sizing: border-box;
  position: absolute;
  top: 50%;
  left: 50%;
  width: 12px;
  height: 32px;
  border-radius: 10px;
  background: var(--dsw-alias-button-floating-fill);
  border: 1px solid var(--dsw-alias-border-l2-darkmode-thin);
  opacity: 0;
  transform: translate(-50%, -50%);
  transition: opacity var(--ds-transition-duration-slow, 0.2s) var(--ds-ease-in-out, ease),
    background var(--ds-transition-duration-slow, 0.2s) var(--ds-ease-in-out, ease);
}
.dcs-col:hover .dcs-col-handle::after,
.dcs-col-handle:hover::after,
.dcs-col-handle[data-dragging]::after { opacity: 1; }
.dcs-col-handle:hover::after,
.dcs-col-handle[data-dragging]::after {
  background: var(--dsw-alias-button-floating-hover);
  border-color: var(--dsw-alias-border-l3);
}
.dcs-tabbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  box-sizing: border-box;
  height: var(--dcs-tabbar-height);
  min-height: var(--dcs-tabbar-height);
  flex-shrink: 0;
  overflow: visible;
  position: relative;
  z-index: 5;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
}
.dcs-tab-scroll {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px 0;
  box-sizing: content-box;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.dcs-tab-scroll::-webkit-scrollbar {
  display: none;
  height: 0;
  width: 0;
}
.dcs-tab-scroll::-webkit-scrollbar:vertical {
  display: none;
  width: 0;
}
.dcs-tab-scroll::-webkit-scrollbar-button {
  display: none;
  width: 0;
  height: 0;
}
.dcs-root button.dcs-tab,
button.dcs-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  min-height: 28px;
  max-height: 28px;
  margin: 0;
  padding: 0 8px;
  border-radius: 7px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 400;
  line-height: 1;
  max-width: 148px;
  flex-shrink: 0;
  cursor: pointer;
  color: var(--dsw-alias-label-secondary);
  user-select: none;
  appearance: none;
  -webkit-appearance: none;
  box-sizing: border-box;
  overflow: visible;
  border: 1px solid transparent;
  background: transparent;
  box-shadow: none;
}
.dcs-tab-scroll[data-reordering],
.dcs-tab-scroll[data-reordering] button.dcs-tab,
button.dcs-tab[data-drag] { cursor: grabbing; }
button.dcs-tab[data-drag] { opacity: 0.45; }
.dcs-tab .dcs-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dcs-tab .dcs-x { opacity: 0; color: var(--dsw-alias-label-tertiary); display: grid; place-items: center; border: 0; background: transparent; color: inherit; cursor: pointer; padding: 0; }
button.dcs-tab:hover, button.dcs-tab[data-on] { color: var(--dsw-alias-label-primary); }
button.dcs-tab:hover:not([data-on]) { background: var(--dsw-alias-interactive-bg-hover); }
button.dcs-tab[data-on] {
  background: var(--dsw-alias-bg-layer-2);
  border-color: var(--dsw-alias-border-l2);
  box-shadow: none;
}
button.dcs-tab:hover .dcs-x, button.dcs-tab[data-on] .dcs-x { opacity: 1; }
.dcs-add {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  height: 100%;
  margin-left: auto;
}
.dcs-root button.dcs-plus,
button.dcs-plus {
  width: var(--dcs-toggle-size); height: var(--dcs-toggle-size); min-height: var(--dcs-toggle-size); margin: 0; padding: 0; border: 0; background: transparent;
  color: var(--dsw-alias-label-secondary); cursor: pointer; display: grid; place-items: center; border-radius: 8px;
  flex-shrink: 0; appearance: none; -webkit-appearance: none; box-sizing: border-box;
}
button.dcs-plus:hover, button.dcs-plus[aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary);
}
.dcs-add-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 248px;
  padding: 6px;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  box-shadow: var(--dsw-shadow-lv2);
  z-index: 8;
}
.dcs-add-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  color: var(--dsw-alias-label-primary);
  text-align: left;
}
.dcs-add-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dcs-add-row svg { color: var(--dsw-alias-label-secondary); flex-shrink: 0; }
.dcs-add-row .dcs-label { flex: 1; font-size: 13.5px; font-weight: 500; letter-spacing: -0.015em; }
.dcs-add-row .dcs-sc { font-size: 12px; color: var(--dsw-alias-label-tertiary); font-weight: 500; white-space: nowrap; }
.dcs-body { flex: 1; overflow: auto; min-height: 0; position: relative; }
.dcs-body[data-center] { display: flex; align-items: center; justify-content: center; }
.dcs-body[data-fill] { display: flex; flex-direction: column; padding: 0; overflow: hidden; }
.dcs-palette { width: 300px; display: flex; flex-direction: column; gap: 1px; }
.dcs-pal-row {
  display: flex; align-items: center; gap: 12px;
  padding: 11px 12px; border-radius: 10px; cursor: pointer;
  color: var(--dsw-alias-label-primary); border: 0; background: transparent; text-align: left; width: 100%;
}
.dcs-pal-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dcs-pal-row svg { color: var(--dsw-alias-label-secondary); flex-shrink: 0; }
.dcs-pal-row .dcs-label { flex: 1; font-size: 14.5px; font-weight: 500; letter-spacing: -0.015em; }
.dcs-pal-row .dcs-sc {
  font-size: 12px; color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
  padding: 3px 9px; border-radius: 999px; font-weight: 500;
}
.dcs-files { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; width: 100%; height: 100%; position: relative; overflow: hidden; }
.dcs-files-split { display: flex; flex: 1; min-height: 0; min-width: 0; overflow: hidden; }
.dcs-preview { flex: 1; min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; background: var(--dsw-alias-bg-base); }
.dcs-preview[data-split] { border-right: 1px solid var(--dsw-alias-border-l2); }
.dcs-fh {
  height: 36px; display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 0 14px 0 10px; border-bottom: 1px solid var(--dsw-alias-border-l2); box-sizing: border-box;
  font-size: 12.5px; color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-1); flex-shrink: 0;
}
.dcs-crumbs {
  flex: 1; min-width: 0; display: flex; align-items: center;
  overflow: hidden; white-space: nowrap;
}
.dcs-crumb-wrap { display: inline-flex; align-items: center; min-width: 0; }
.dcs-crumb, .dcs-crumb-file {
  border: 0; background: transparent; padding: 0; cursor: pointer;
  font: inherit; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dcs-crumb { color: var(--dsw-alias-label-tertiary); }
.dcs-crumb:hover { color: var(--dsw-alias-label-primary); }
.dcs-crumb-file { color: var(--dsw-alias-label-primary); font-weight: 500; flex-shrink: 0; max-width: none; }
.dcs-crumb-sep { margin: 0 5px; color: var(--dsw-alias-label-tertiary); }
.dcs-fh-search {
  width: 160px; height: 26px; padding: 0 8px; border-radius: 6px; flex-shrink: 0;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary); outline: none; font-size: 12.5px;
}
.dcs-fh-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; margin-left: auto; padding-right: 2px; }
.dcs-fh-menu { position: relative; }
.dcs-fh-pop {
  position: absolute; top: 30px; right: 0; z-index: 8; min-width: 132px; padding: 4px;
  background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px; box-shadow: var(--dsw-shadow-lv2);
}
.dcs-fh-pop button {
  display: block; width: 100%; text-align: left; border: 0; background: transparent;
  padding: 8px 10px; border-radius: 7px; font-size: 13px; cursor: pointer;
  color: var(--dsw-alias-label-primary);
}
.dcs-fh-pop button[data-on] { background: var(--dsw-alias-bg-layer-2); }
.dcs-tool {
  width: 26px; height: 26px; padding: 0; border: 0; border-radius: 6px; cursor: pointer;
  background: transparent; color: var(--dsw-alias-label-secondary);
  display: grid; place-items: center; flex-shrink: 0; overflow: visible; box-sizing: border-box;
}
.dcs-tool svg { display: block; overflow: visible; width: 14px; height: 14px; }
.dcs-tool:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dcs-tool[data-on] { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); }
.dcs-fh-actions .dcs-tool[data-on] {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dcs-code {
  flex: 1; min-width: 0; min-height: 0; overflow: auto; font-family: var(--ds-font-family-code);
  font-size: 12.5px; line-height: 1.6; padding: 8px 12px 12px;
}
.dcs-tok-kw { color: #7c3aed; }
.dcs-tok-str { color: #0f766e; }
.dcs-tok-com { color: var(--dsw-alias-label-tertiary); font-style: italic; }
.dcs-tok-num { color: #c2410c; }
.dcs-tok-punc { color: #64748b; }
[data-theme='dark'] .dcs-tok-kw, .dcs-root:not([data-theme]) .dcs-tok-kw { color: #c4b5fd; }
[data-theme='dark'] .dcs-tok-str { color: #5eead4; }
[data-theme='dark'] .dcs-tok-num { color: #fdba74; }
[data-theme='dark'] .dcs-tok-punc { color: #94a3b8; }
.dcs-fseg {
  display: flex; flex-shrink: 0; background: var(--dsw-alias-bg-layer-2);
  border-radius: 7px; padding: 2px; margin-right: 4px;
}
.dcs-fseg button {
  border: 0; background: transparent; padding: 3px 8px; border-radius: 5px;
  font-size: 11px; cursor: pointer; color: var(--dsw-alias-label-secondary); white-space: nowrap;
}
.dcs-fseg button[data-on] {
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  box-shadow: 0 0 0 1px var(--dsw-alias-border-l2);
}
.dcs-fseg .dcs-addn { color: #16a34a; }
.dcs-fseg .dcs-deln { color: #dc2626; }
.dcs-code { display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
.dcs-fd {
  flex: 1; min-width: 0; min-height: 0; width: 100%; overflow: auto; box-sizing: border-box;
  font-family: var(--ds-font-family-code); font-size: 12.5px; line-height: 1.55;
  padding: 8px 10px 16px;
}
.dcs-fd-hunk {
  padding: 5px 10px; color: var(--dsw-alias-label-tertiary);
  background: var(--dsw-alias-bg-layer-2); font-size: 11px; border-radius: 6px 6px 0 0;
}
.dcs-fd-line {
  display: grid; grid-template-columns: 2.6em 1em minmax(0, 1fr);
  align-items: start; min-width: 0; line-height: 1.55;
}
.dcs-fd-line[data-kind="add"] { background: color-mix(in srgb, #16a34a 14%, transparent); }
.dcs-fd-line[data-kind="del"] { background: color-mix(in srgb, #dc2626 14%, transparent); }
.dcs-fd-ln {
  text-align: right; padding: 0 6px 0 0; color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums; user-select: none; line-height: inherit;
}
.dcs-fd-ln[data-kind="del"] { color: #dc2626; }
.dcs-fd-ln[data-kind="add"] { color: #16a34a; }
.dcs-fd-sign { color: var(--dsw-alias-label-tertiary); line-height: inherit; }
.dcs-fd-sign[data-kind="add"] { color: #16a34a; }
.dcs-fd-sign[data-kind="del"] { color: #dc2626; }
.dcs-fd-code {
  white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word;
  min-width: 0; padding-right: 12px; color: var(--dsw-alias-label-primary);
  line-height: inherit;
}
.dcs-code[data-media] { padding: 0; }
.dcs-md {
  flex: 1; min-height: 0; overflow: auto; box-sizing: border-box;
  padding: 18px 20px 36px; font-size: 13.5px; line-height: 1.6;
  font-family: var(--dsw-font-family, inherit);
  color: var(--dsw-alias-label-primary);
}
.dcs-md h1, .dcs-md h2, .dcs-md h3 { font-weight: 600; letter-spacing: -0.02em; line-height: 1.3; }
.dcs-md h1 { margin: 0 0 16px; font-size: 22px; }
.dcs-md h2 { margin: 24px 0 12px; font-size: 18px; }
.dcs-md h3 { margin: 20px 0 10px; font-size: 15px; }
.dcs-md p { margin: 0 0 12px; color: var(--dsw-alias-label-secondary); }
.dcs-md ul, .dcs-md ol { margin: 0 0 14px; padding-left: 24px; color: var(--dsw-alias-label-secondary); }
.dcs-md li { margin: 3px 0; }
.dcs-md blockquote { margin: 0 0 14px; padding: 7px 12px; border-left: 3px solid var(--dsw-alias-border-l3); color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-1); }
.dcs-md hr { margin: 20px 0; border: 0; border-top: 1px solid var(--dsw-alias-border-l2); }
.dcs-md a { color: var(--dsw-alias-state-business-primary); text-decoration: none; }
.dcs-md a:hover { text-decoration: underline; }
.dcs-md-code { padding: 1px 5px; border-radius: 5px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-family: var(--ds-font-family-code); font-size: 0.92em; overflow-wrap: anywhere; }
.dcs-md-pre { margin: 0 0 14px; padding: 12px 14px; overflow: auto; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); font-family: var(--ds-font-family-code); font-size: 12.5px; line-height: 1.55; }
.dcs-md-table-wrap { margin: 8px 0 18px; overflow-x: auto; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; }
.dcs-md table { width: max-content; min-width: 100%; border-collapse: collapse; font-size: 12.5px; line-height: 1.45; }
.dcs-md th, .dcs-md td { max-width: 420px; padding: 8px 10px; text-align: left; vertical-align: top; border-right: 1px solid var(--dsw-alias-border-l2); border-bottom: 1px solid var(--dsw-alias-border-l2); overflow-wrap: anywhere; }
.dcs-md th { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-weight: 600; }
.dcs-md td { color: var(--dsw-alias-label-secondary); }
.dcs-md th:last-child, .dcs-md td:last-child { border-right: 0; }
.dcs-md tbody tr:last-child td { border-bottom: 0; }
.dcs-code[data-mark] { cursor: crosshair; }
.dcs-line { display: grid; grid-template-columns: 40px minmax(0, 1fr); align-items: center; }
.dcs-line .dcs-n { position: relative; text-align: right; padding-right: 12px; color: var(--dsw-alias-label-tertiary); user-select: none; }
.dcs-line-badge {
  position: absolute; left: 0; top: 50%; transform: translateY(-50%);
  width: 16px; height: 16px; border-radius: 50%;
  display: grid; place-items: center;
  background: #38bdf8; color: #0f172a;
  font-size: 10px; font-weight: 700; line-height: 1;
}
.dcs-line .dcs-t { color: var(--dsw-alias-label-primary); white-space: pre; padding-right: 16px; }
.dcs-missing {
  padding: 24px 18px;
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 13px;
}
.dcs-files-empty {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--dsw-alias-label-tertiary);
  font-size: 14px;
  background: var(--dsw-alias-bg-base);
}
.dcs-tree {
  position: relative; flex: 0 0 auto; min-width: 160px; max-width: 42%;
  display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-layer-1);
  border-left: 1px solid var(--dsw-alias-border-l2);
  overflow: hidden;
}
.dcs-tree-handle {
  position: relative; z-index: 4; flex: 0 0 16px; width: 16px; margin: 0 -8px;
  cursor: col-resize; touch-action: none; align-self: stretch;
}
.dcs-tree-handle::after {
  content: ''; position: absolute; top: 50%; left: 50%;
  width: 4px; height: 48px; border-radius: 999px;
  background: var(--dsw-alias-button-floating-fill);
  border: 1px solid var(--dsw-alias-border-l2);
  opacity: 0; transform: translate(-50%, -50%);
}
.dcs-files-split:hover .dcs-tree-handle::after,
.dcs-tree-handle:hover::after,
.dcs-tree-handle[data-dragging]::after { opacity: 1; }
.dcs-tool-stat {
  margin-left: 8px; font-size: 12px; font-variant-numeric: tabular-nums;
  white-space: nowrap; pointer-events: none;
}
.dcs-tool-stat .add { color: #16a34a; }
.dcs-tool-stat .del { color: #dc2626; margin-left: 4px; }
.dcs-tree-head {
  height: 36px; display: flex; align-items: center; gap: 0;
  padding: 0 6px 0 14px; flex-shrink: 0;
}
.dcs-tree-title {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary);
}
.dcs-tree-head .dcs-tool { color: var(--dsw-alias-label-tertiary); }
.dcs-tree-body { flex: 1; overflow: auto; padding: 2px 8px 12px; }
.dcs-tree-row {
  display: flex; align-items: center; gap: 6px;
  height: 28px; padding-right: 8px; border-radius: 6px;
  border: 0; background: transparent; width: 100%; text-align: left; cursor: pointer;
  color: var(--dsw-alias-label-secondary); font-size: 13px; font-weight: 400; line-height: 28px;
}
.dcs-tree-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dcs-tree-row[data-on] { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dcs-tree-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dcs-caret {
  width: 16px; height: 16px; flex-shrink: 0; display: grid; place-items: center;
  color: var(--dsw-alias-label-tertiary);
}
.dcs-caret::before {
  content: ''; width: 0; height: 0;
  border-style: solid; border-width: 3.5px 0 3.5px 5.5px;
  border-color: transparent transparent transparent currentColor;
}
.dcs-caret[data-open] { transform: rotate(90deg); }
.dcs-fglyph { width: 16px; height: 16px; flex-shrink: 0; display: block; opacity: 0.72; }
.dcs-term-wrap { flex: 1; min-height: 0; min-width: 0; display: flex; }
.dcs-term-rail {
  width: 168px; flex-shrink: 0; min-height: 0;
  display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-layer-1);
  border-left: 1px solid var(--dsw-alias-border-l2);
}
.dcs-term-rail[data-collapsed] {
  width: 36px; align-items: center; padding-top: 6px;
}
.dcs-term-rail-head {
  height: 36px; flex-shrink: 0; display: flex; align-items: center; gap: 2px;
  padding: 0 6px 0 12px;
}
.dcs-term-rail-count {
  flex: 1; min-width: 0; font-size: 12px; font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}
.dcs-term-rail-icon {
  width: 26px; height: 26px; flex-shrink: 0; padding: 0; border: 0;
  border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary);
  display: grid; place-items: center; cursor: pointer;
}
.dcs-term-rail-icon:hover {
  background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary);
}
.dcs-term-rail-list { flex: 1; min-height: 0; overflow: auto; padding: 4px 0 8px; }
.dcs-term-session {
  width: calc(100% - 16px); margin: 1px 8px; padding: 6px 8px;
  border: 0; border-radius: 8px; background: transparent;
  color: var(--dsw-alias-label-primary); display: flex; align-items: center; gap: 8px;
  text-align: left; cursor: pointer; font: inherit; font-size: 13px;
}
.dcs-term-session:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dcs-term-session[data-on] { background: var(--dsw-alias-interactive-bg-active, var(--dsw-alias-bg-layer-2)); }
.dcs-term-session-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dcs-term-session-x {
  opacity: 0;
  flex-shrink: 0;
  width: 18px; height: 18px; margin-left: auto;
  display: grid; place-items: center;
  border: 0; border-radius: 4px; background: transparent;
  color: var(--dsw-alias-label-tertiary); cursor: pointer; padding: 0;
}
.dcs-term-session:hover .dcs-term-session-x,
.dcs-term-session:focus-within .dcs-term-session-x { opacity: 1; }
.dcs-term-session-x:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.dcs-term {
  flex: 1; min-height: 0; overflow: hidden; padding: 8px 10px;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  font-family: var(--ds-font-family-code); font-size: 13px;
  cursor: text;
  --dcs-term-bg: var(--dsw-alias-bg-base);
  --dcs-term-fg: var(--dsw-alias-label-primary);
  --dcs-term-cursor: var(--dsw-alias-label-primary);
  --dcs-term-cursor-accent: var(--dsw-alias-bg-base);
  --dcs-term-selection: var(--dsw-alias-bg-layer-2);
  --dcs-term-black: var(--dsw-alias-label-primary);
  --dcs-term-red: var(--dsw-alias-state-error-primary);
  --dcs-term-green: var(--dsw-alias-state-success-primary);
  --dcs-term-yellow: var(--dsw-alias-state-warn-primary);
  --dcs-term-blue: var(--dsw-alias-state-business-primary);
  --dcs-term-magenta: color-mix(in srgb, var(--dsw-alias-state-business-primary) 50%, var(--dsw-alias-state-error-primary));
  --dcs-term-cyan: color-mix(in srgb, var(--dsw-alias-state-business-primary) 50%, var(--dsw-alias-state-success-primary));
  --dcs-term-white: var(--dsw-alias-label-secondary);
  --dcs-term-bright-black: var(--dsw-alias-label-tertiary);
  --dcs-term-bright-red: var(--dsw-alias-state-error-secondary);
  --dcs-term-bright-green: var(--dsw-alias-state-success-secondary);
  --dcs-term-bright-yellow: var(--dsw-alias-state-warn-label);
  --dcs-term-bright-blue: var(--dsw-alias-state-business-primary);
  --dcs-term-bright-magenta: color-mix(in srgb, var(--dsw-alias-state-business-primary) 35%, var(--dsw-alias-state-error-secondary));
  --dcs-term-bright-cyan: color-mix(in srgb, var(--dsw-alias-state-business-primary) 35%, var(--dsw-alias-state-success-secondary));
  --dcs-term-bright-white: var(--dsw-alias-label-primary);
}
.dcs-term, .dcs-term .xterm, .dcs-term .xterm-char-measure-element {
  line-height: 1;
  letter-spacing: 0;
  font-variant-ligatures: none;
  font-feature-settings: "liga" 0;
}
.dcs-term .xterm { width: 100%; height: 100%; }
.dcs-term .xterm-viewport { background-color: var(--dsw-alias-bg-base) !important; }
.xterm {
  cursor: text; position: relative;
  user-select: none; -ms-user-select: none; -webkit-user-select: none;
}
.xterm.focus, .xterm:focus { outline: none; }
.xterm .xterm-helpers { position: absolute; top: 0; z-index: 5; }
.xterm .xterm-helper-textarea {
  padding: 0; border: 0; margin: 0; position: absolute; opacity: 0;
  left: -9999em; top: 0; width: 0; height: 0; z-index: -5;
  white-space: nowrap; overflow: hidden; resize: none;
}
.xterm .composition-view {
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  display: none; position: absolute; white-space: nowrap; z-index: 1;
}
.xterm .composition-view.active { display: block; }
.xterm .xterm-viewport {
  overflow-y: scroll; cursor: default; position: absolute;
  right: 0; left: 0; top: 0; bottom: 0;
}
.xterm .xterm-screen { position: relative; }
.xterm .xterm-screen canvas { position: absolute; left: 0; top: 0; }
.xterm .xterm-scroll-area { visibility: hidden; }
.xterm-char-measure-element {
  display: inline-block; visibility: hidden; position: absolute;
  top: 0; left: -9999em; line-height: normal;
}
.xterm.enable-mouse-events { cursor: default; }
.xterm.xterm-cursor-pointer, .xterm .xterm-cursor-pointer { cursor: pointer; }
.xterm .xterm-accessibility, .xterm .xterm-message {
  position: absolute; left: 0; top: 0; bottom: 0; right: 0;
  z-index: 10; color: transparent; pointer-events: none;
}
.xterm .live-region {
  position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden;
}
.dcs-note {
  position: absolute;
  z-index: 8;
  overflow: visible;
  width: max-content;
  min-width: min(248px, calc(100% - 16px));
  max-width: min(360px, calc(100% - 16px));
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
  box-shadow: var(--dsw-shadow-lv2);
  border-radius: 999px;
  padding: 4px 6px 4px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
}
.dcs-note[data-object] {
  padding-left: 10px;
}
.dcs-note-obj {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 1;
  min-width: 0;
  max-width: 42%;
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
  line-height: 1;
  font-weight: 500;
}
.dcs-note-obj span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dcs-note-obj svg { flex-shrink: 0; color: var(--dsw-alias-label-secondary); }
.dcs-note-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.dcs-note input {
  flex: 1; min-width: 0; width: auto; background: transparent; border: 0; outline: none;
  color: var(--dsw-alias-label-primary); font-size: 13.5px;
}
.dcs-note-add {
  flex-shrink: 0;
  height: 26px;
  padding: 0 8px;
  border: 0;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.dcs-note-add:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dcs-note-send {
  width: 26px; height: 26px; flex-shrink: 0; border: 0; border-radius: 999px;
  display: grid; place-items: center; cursor: pointer;
  background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base);
  padding: 0;
}
.dcs-note-send:hover { filter: brightness(1.08); }
.dcs-note-send-wrap {
  position: relative;
  flex-shrink: 0;
}
.dcs-tip {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 8;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 12px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2);
  box-shadow: var(--dsw-shadow-lv2);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  white-space: nowrap;
  transition: opacity 80ms ease 80ms, visibility 0s linear 160ms;
}
.dcs-note-send-wrap:hover .dcs-tip,
.dcs-note-send-wrap:focus-within .dcs-tip {
  opacity: 1;
  visibility: visible;
  transition-delay: 120ms, 0s;
}
.dcs-tip-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  color: var(--dsw-alias-label-primary);
}
.dcs-tip-keys {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.dcs-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  box-sizing: border-box;
  border: 0;
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 500;
  font-family: inherit;
  line-height: 1;
}
.dcs-kbd svg { display: block; }
.dcs-later {
  flex: 1; display: flex; align-items: center; justify-content: center;
  color: var(--dsw-alias-label-tertiary); font-size: 13px; padding: 24px;
}
.dcs-root button.dcs-toggle,
button.dcs-toggle {
  width: var(--dcs-toggle-size);
  height: var(--dcs-toggle-size);
  min-width: var(--dcs-toggle-size);
  min-height: var(--dcs-toggle-size);
  margin: 0;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  appearance: none;
  -webkit-appearance: none;
  box-sizing: border-box;
  align-self: center;
}
[class*="centerCol"] [class$="_header"] {
  padding-top: var(--dcs-toggle-pad) !important;
  padding-right: var(--dcs-toggle-pad) !important;
}
.dcs-toggle:hover, .dcs-toggle[data-on] {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
[class*="detailsCol"] {
  overflow: visible !important;
  min-width: 0;
}
[class$="_frame"]:has([data-shell-overlay]) {
  grid-template-columns: var(--dcs-sidebar-track, 56px) minmax(0, 1fr) var(--dcs-details-track, 0px) !important;
}
[class$="_frame"]:has([data-shell-overlay]):not([data-details-collapsed]) {
  transition: none !important;
}
[data-side="details"] { display: none !important; }
.dcs-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
  padding: 0 4px 8px;
}
.dcs-root > .dcs-chips {
  padding: 6px 10px 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.dcs-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 220px;
  font-size: 12px;
  background: var(--dsw-alias-bg-layer-2);
  border-radius: 999px;
  padding: 3px 8px 3px 6px;
  color: var(--dsw-alias-label-secondary);
}
.dcs-chip-count { padding-left: 10px; padding-right: 10px; font-weight: 600; }
.dcs-chip-n {
  width: 16px; height: 16px; flex-shrink: 0; border-radius: 50%;
  display: grid; place-items: center;
  background: #38bdf8; color: #0f172a;
  font-size: 10px; font-weight: 700; line-height: 1;
}
.dcs-chip-from { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dcs-chip-x {
  width: 14px; height: 14px; padding: 0; border: 0; border-radius: 50%;
  background: transparent; color: var(--dsw-alias-label-tertiary);
  display: grid; place-items: center; cursor: pointer;
}
.dcs-chip-x:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.dcs-b-badge {
  position: absolute; z-index: 4; pointer-events: none;
  min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box;
  border-radius: 999px;
  display: grid; place-items: center;
  background: #38bdf8; color: #0f172a;
  font-size: 11px; font-weight: 700; line-height: 1;
  transform: translate(-50%, -100%);
  margin-top: -2px;
}

`

export function ensureSidebarStyles(): void {
  if (typeof document === 'undefined') return
  let style = document.getElementById('dsh-codex-sidebar-css') as HTMLStyleElement | null
  if (style === null) {
    style = document.createElement('style')
    style.id = 'dsh-codex-sidebar-css'
    document.head.appendChild(style)
  }
  style.textContent = SIDEBAR_CSS
}
