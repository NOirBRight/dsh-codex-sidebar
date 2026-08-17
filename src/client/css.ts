/** Host-theme chrome. Prototype IA; DSH tokens instead of a light Codex island. */

export const SIDEBAR_CSS = `
.dcs-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  border-left: 1px solid var(--dsw-alias-border-l2);
}
.dcs-tabbar {
  height: 40px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  flex-shrink: 0;
}
.dcs-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 7px;
  border-radius: 7px;
  font-size: 12.5px;
  max-width: 148px;
  cursor: pointer;
  color: var(--dsw-alias-label-secondary);
  user-select: none;
  border: 0;
  background: transparent;
}
.dcs-tab .dcs-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dcs-tab .dcs-x { opacity: 0; color: var(--dsw-alias-label-tertiary); display: grid; place-items: center; border: 0; background: transparent; color: inherit; cursor: pointer; padding: 0; }
.dcs-tab:hover, .dcs-tab[data-on] { color: var(--dsw-alias-label-primary); }
.dcs-tab[data-on] { background: var(--dsw-alias-bg-layer-2); box-shadow: 0 0 0 1px var(--dsw-alias-border-l2); }
.dcs-tab:hover .dcs-x, .dcs-tab[data-on] .dcs-x { opacity: 1; }
.dcs-plus {
  width: 26px; height: 26px; border: 0; background: transparent;
  color: var(--dsw-alias-label-secondary); cursor: pointer; display: grid; place-items: center; border-radius: 6px;
}
.dcs-plus:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
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
.dcs-files { display: flex; flex: 1; min-height: 0; height: 100%; }
.dcs-preview { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--dsw-alias-bg-base); }
.dcs-preview[data-split] { border-right: 1px solid var(--dsw-alias-border-l2); }
.dcs-fh {
  height: 36px; display: flex; align-items: center; gap: 8px;
  padding: 0 10px; border-bottom: 1px solid var(--dsw-alias-border-l2);
  font-size: 12.5px; color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-1); flex-shrink: 0;
}
.dcs-fh .dcs-path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); }
.dcs-fh .dcs-dir { color: var(--dsw-alias-label-tertiary); }
.dcs-tool {
  width: 26px; height: 26px; border: 0; border-radius: 6px; cursor: pointer;
  background: transparent; color: var(--dsw-alias-label-secondary); display: grid; place-items: center;
}
.dcs-tool:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dcs-tool[data-on] { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); }
.dcs-code {
  flex: 1; overflow: auto; font-family: var(--ds-font-family-code);
  font-size: 12.5px; line-height: 1.6; padding: 10px 0;
}
.dcs-code[data-media] { padding: 0; }
.dcs-md {
  font-family: var(--dsw-font-family, inherit);
  color: var(--dsw-alias-label-primary);
}
.dcs-md h1, .dcs-md h2, .dcs-md h3 { font-weight: 600; letter-spacing: -0.02em; }
.dcs-md p { color: var(--dsw-alias-label-secondary); }
.dcs-code[data-mark] { cursor: crosshair; }
.dcs-line { display: grid; grid-template-columns: 44px 1fr; }
.dcs-line .dcs-n { text-align: right; padding-right: 14px; color: var(--dsw-alias-label-tertiary); user-select: none; }
.dcs-line .dcs-t { color: var(--dsw-alias-label-primary); white-space: pre; padding-right: 16px; }
.dcs-tree {
  width: 156px; flex-shrink: 0; display: flex; flex-direction: column; background: var(--dsw-alias-bg-layer-1);
}
.dcs-tree-body { flex: 1; overflow: auto; padding: 8px 6px; font-size: 12.5px; }
.dcs-tree-folder {
  display: flex; align-items: center; gap: 6px;
  padding: 3px 6px; color: var(--dsw-alias-label-secondary); font-weight: 500;
}
.dcs-tree-file {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 6px 4px 22px; border-radius: 6px; cursor: pointer;
  color: var(--dsw-alias-label-secondary); border: 0; background: transparent; width: 100%; text-align: left;
}
.dcs-tree-file[data-root] { padding-left: 6px; }
.dcs-tree-file[data-on] { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dcs-note {
  position: absolute;
  z-index: 6;
  min-width: 248px;
  max-width: min(360px, calc(100% - 24px));
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
  box-shadow: var(--dsw-shadow-lv2);
  border-radius: 999px;
  padding: 7px 16px;
  display: flex;
  align-items: center;
  transform: translateX(-50%);
}
.dcs-note input {
  width: 220px; background: transparent; border: 0; outline: none;
  color: var(--dsw-alias-label-primary); font-size: 13.5px;
}
.dcs-later {
  flex: 1; display: flex; align-items: center; justify-content: center;
  color: var(--dsw-alias-label-tertiary); font-size: 13px; padding: 24px;
}
.dcs-toggle {
  width: 32px; height: 32px; border: 0; border-radius: 8px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  cursor: pointer; display: grid; place-items: center;
}
.dcs-toggle:hover, .dcs-toggle[data-on] {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dcs-chips { display: flex; gap: 6px; flex-wrap: wrap; padding: 0 4px 6px; }
.dcs-chip {
  font-size: 12px;
  background: var(--dsw-alias-bg-layer-2);
  border-radius: 999px;
  padding: 3px 10px;
  color: var(--dsw-alias-label-secondary);
}
`

export function ensureSidebarStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById('dsh-codex-sidebar-css')) return
  const style = document.createElement('style')
  style.id = 'dsh-codex-sidebar-css'
  style.textContent = SIDEBAR_CSS
  document.head.appendChild(style)
}
