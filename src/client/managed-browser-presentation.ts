/** CSS for the managed Browser media surface, hit layer, and in-surface highlights. */
export const MANAGED_BROWSER_PRESENTATION_CSS = `
.dcs-managed-browser { position:absolute; inset:0; overflow:hidden; display:grid; place-items:center; background:#f3f4f6; }
.dcs-managed-browser-surface { position:relative; flex:none; overflow:hidden; background:#fff; box-shadow:0 1px 8px rgba(15,23,42,.16); touch-action:none; }
.dcs-managed-browser-video, .dcs-managed-browser-canvas { width:100%; height:100%; display:block; object-fit:contain; object-position:center; pointer-events:none; }
.dcs-managed-browser-video { opacity:0; }
.dcs-managed-browser-video[data-dcs-presenter] { opacity:1; }
.dcs-managed-browser-canvas { outline:none; }
.dcs-managed-browser-input { position:absolute; inset:0; z-index:3; touch-action:none; user-select:none; }
.dcs-managed-ime { position:absolute; left:-10000px; top:0; width:1px; height:1px; opacity:0; }
.dcs-managed-browser-status { position:absolute; inset:0; z-index:6; display:grid; place-items:center; pointer-events:none; color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-bg-base); font-size:13px; }
.dcs-managed-selected, .dcs-managed-hover, .dcs-managed-selection { position:absolute; pointer-events:none; box-sizing:border-box; z-index:2; }
.dcs-managed-selected { border:2px solid #0ea5e9; background:rgba(14,165,233,.2); box-shadow:0 0 0 1px rgba(255,255,255,.7) inset; }
.dcs-managed-hover { border:1.5px solid #38bdf8; background:rgba(56,189,248,.1); }
.dcs-managed-selection { border:1.5px solid #38bdf8; background:rgba(56,189,248,.18); }
`
