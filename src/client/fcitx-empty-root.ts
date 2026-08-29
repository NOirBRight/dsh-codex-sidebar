/** fcitx5/XWayland bridge for Lexical's empty-root composition marker bug. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

export const FCITX_EMPTY_ROOT_SEED = '​'
export const X11_LAUNCHER_FLAG = 'dsh-launcher-x11'

/** Only the X11 launcher opt-in gets the workaround; ordinary browsers stay native. */
export function isX11Launcher(location: Pick<Location, 'search'>, storage?: Pick<Storage, 'getItem'>): boolean {
  if (new URLSearchParams(location.search).get('dsh-launcher') === 'x11') return true
  try { return storage?.getItem(X11_LAUNCHER_FLAG) === '1' } catch { return false }
}

/** Remove the private empty-root seed after composition settles. */
export function stripFcitxSeed(draft: string): string {
  return draft.startsWith(FCITX_EMPTY_ROOT_SEED) ? draft.slice(FCITX_EMPTY_ROOT_SEED.length) : draft
}

/**
 * Seed Lexical state before fcitx starts composing into an empty root.
 * Lexical 0.49 otherwise creates its suffix only after the first input and
 * leaves the replacement composition at offset 0, dropping the first pinyin
 * letter under Ozone/X11.
 */
export function installFcitxEmptyRootBridge(ctx: ClientContext): () => void {
  if (typeof document === 'undefined' || !isX11Launcher(location, sessionStorage)) return () => {}
  const seeded = new WeakMap<HTMLElement, { input: { state: { getSnapshot(): { draft: string } }; setDraft(text: string): void } }>()
  const inputForCurrent = () => {
    const current = ctx.sessions.list.getSnapshot().current
    if (current === undefined) return undefined
    const binding = ctx.sessions.binding(current as never)
    if (binding === undefined) return undefined
    return ctx.conversation.input.for(binding.ctx)
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Process' || event.keyCode !== 229 || event.isComposing) return
    const target = event.target
    if (!(target instanceof Element)) return
    const root = target.closest<HTMLElement>('[data-composer-input]')
    if (root === null || (root.textContent ?? '') !== '') return
    const input = inputForCurrent()
    if (input === undefined || input.state.getSnapshot().draft !== '') return
    input.setDraft(FCITX_EMPTY_ROOT_SEED)
    seeded.set(root, { input })
  }
  const onCompositionEnd = (event: CompositionEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const root = target.closest<HTMLElement>('[data-composer-input]')
    if (root === null) return
    const record = seeded.get(root)
    if (record === undefined) return
    seeded.delete(root)
    queueMicrotask(() => {
      const draft = record.input.state.getSnapshot().draft
      const clean = stripFcitxSeed(draft)
      if (clean !== draft) record.input.setDraft(clean)
    })
  }
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('compositionend', onCompositionEnd, true)
  return () => {
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('compositionend', onCompositionEnd, true)
  }
}
