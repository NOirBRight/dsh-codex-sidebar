/** Palette inside an empty Tab, and the + menu that fills a Tab in one click. */

import type { ReactElement } from 'react'
import type { ToolKind } from '../session.ts'
import { Ico, type IconName } from './icons.tsx'

export const TOOL_ROWS: ReadonlyArray<{ kind: ToolKind; icon: IconName; shortcut: string }> = [
  { kind: 'Review', icon: 'review', shortcut: 'Ctrl+Shift+G' },
  { kind: 'Terminal', icon: 'terminal', shortcut: 'Ctrl+`' },
  { kind: 'Browser', icon: 'globe', shortcut: 'Ctrl+T' },
  { kind: 'Files', icon: 'folder', shortcut: 'Ctrl+P' },
  { kind: 'Side Chat', icon: 'chat', shortcut: 'Ctrl+Alt+S' },
]

export function Palette({ onPick }: { onPick: (kind: ToolKind) => void }): ReactElement {
  return (
    <div className="dcs-palette">
      {TOOL_ROWS.map((row) => (
        <button key={row.kind} type="button" className="dcs-pal-row" onClick={() => { onPick(row.kind) }}>
          <Ico name={row.icon} size={18} />
          <span className="dcs-label">{row.kind}</span>
          <span className="dcs-sc">{row.shortcut}</span>
        </button>
      ))}
    </div>
  )
}

export function AddMenu({ onPick }: { onPick: (kind: ToolKind) => void }): ReactElement {
  return (
    <div className="dcs-add-menu" role="menu">
      {TOOL_ROWS.map((row) => (
        <button
          key={row.kind}
          type="button"
          role="menuitem"
          className="dcs-add-row"
          onClick={() => { onPick(row.kind) }}
        >
          <Ico name={row.icon} size={16} />
          <span className="dcs-label">{row.kind}</span>
          <span className="dcs-sc">{row.shortcut}</span>
        </button>
      ))}
    </div>
  )
}
