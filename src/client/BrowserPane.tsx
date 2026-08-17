/** Browser 工具 pane. Ticket 03 owns this file. */

import type { ReactElement } from 'react'

export function BrowserPane({ later }: { later: string }): ReactElement {
  return <div className="dcs-later">{later}</div>
}
