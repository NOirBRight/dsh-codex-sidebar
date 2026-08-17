/** Terminal 工具 pane. Ticket 04 owns this file. */

import type { ReactElement } from 'react'

export function TerminalPane({ later }: { later: string }): ReactElement {
  return <div className="dcs-later">{later}</div>
}
