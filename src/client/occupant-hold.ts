/** DSH single-slot renderer abdicates on an uncaught render crash. Hold the error in-tree instead. */

export type OccupantHold = {
  abdicate: false
  message: string
}

export function retainDetailsOccupantAfterRenderError(error: unknown): OccupantHold {
  const message = error instanceof Error ? error.message : String(error)
  return { abdicate: false, message: message.length > 0 ? message : 'Sidebar pane crashed' }
}
