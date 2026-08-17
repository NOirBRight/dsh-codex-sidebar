/** Side Chat 工具 pane. Ticket 05 owns this file. */

import type { ReactElement } from 'react'

export function SideChatPane({ later }: { later: string }): ReactElement {
  return <div className="dcs-later">{later}</div>
}
