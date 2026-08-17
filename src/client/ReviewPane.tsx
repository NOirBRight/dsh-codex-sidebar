/** Review 工具 pane. Ticket 02 owns this file. */

import type { ReactElement } from 'react'

export function ReviewPane({ later }: { later: string }): ReactElement {
  return <div className="dcs-later">{later}</div>
}
