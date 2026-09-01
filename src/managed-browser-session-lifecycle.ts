/** Session-owned resources released by the managed Browser lifecycle hook. */
export interface ManagedBrowserSessionStream {
  /** Close every stream for one session. */
  closeSession: (sessionId: string) => void
}

/** Browser pages released by the managed Browser lifecycle hook. */
export interface ManagedBrowserSessionRuntime {
  /** Close every page for one session. */
  closeSession: (sessionId: string) => Promise<void>
}

/** Context surface required to observe session disposal globally. */
export interface ManagedBrowserSessionContext {
  /** Register a session lifecycle listener. */
  on: (
    name: 'session/disposed',
    listener: (session: { id: string }) => void,
    options: { global: true },
  ) => () => void
}

/**
 * Release resources whose lifetime is owned by a disposed DSH session.
 * @param ctx - Cordis context that observes all session scopes.
 * @param stream - managed Browser stream owner.
 * @param runtime - managed Browser page owner.
 * @param filesBySession - lazily created file ports keyed by session id.
 * @returns disposer for the lifecycle listener.
 */
export function installManagedBrowserSessionLifecycle(
  ctx: ManagedBrowserSessionContext,
  stream: ManagedBrowserSessionStream,
  runtime: ManagedBrowserSessionRuntime,
  filesBySession: Map<string, unknown>,
): () => void {
  return ctx.on('session/disposed', (session) => {
    stream.closeSession(session.id)
    filesBySession.delete(session.id)
    void runtime.closeSession(session.id).catch((error: unknown) => {
      console.warn(`[dsh-codex-sidebar] failed to close Browser session ${session.id}: ${String(error)}`)
    })
  }, { global: true })
}
