/** Turn transcript file paths into clicks that open Files. */

import { allowTranscriptTakeover } from '../transcript-takeover.ts'

const MARK = 'dcs-path-link'
const OBSERVE: MutationObserverInit = { childList: true, subtree: true }
const FILE_EXT = /\.(tsx?|jsx?|mjs|cjs|md|json|css|html?|vue|svelte|py|rs|go|toml|ya?ml|svg|png|jpe?g|gif|webp|txt|map|lock|sh|bash)$/i

export function transcriptPath(text: string): string | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0 || trimmed.length > 512) return undefined
  if (/\s/.test(trimmed)) return undefined
  if (/^https?:/i.test(trimmed)) return undefined
  if (trimmed.startsWith('/') || trimmed.startsWith('~/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return trimmed
  }
  if (trimmed.includes('/') && FILE_EXT.test(trimmed)) return trimmed
  if (FILE_EXT.test(trimmed) && !trimmed.startsWith('.')) return trimmed
  return undefined
}

export function installPathLinks(openPath: (path: string) => void): { stop: () => void; paint: () => void } {
  if (typeof document === 'undefined') return { stop() {}, paint() {} }
  let observer: MutationObserver
  const paint = (): void => {
    observer.disconnect()
    try { decorate(openPath) } finally { observer.observe(document.documentElement, OBSERVE) }
  }
  observer = new MutationObserver(paint)
  observer.observe(document.documentElement, OBSERVE)
  paint()
  return { stop() { observer.disconnect() }, paint }
}

export function decorate(openPath: (path: string) => void, root: ParentNode = document): void {
  const nodes = root.querySelectorAll('code')
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue
    if (node.closest('.dcs-root, .dcs-col, [data-shell-overlay]')) continue
    if (node.closest('a, button, [data-tool]')) continue
    const closest = (selector: string) => node.closest(selector)
    if (!allowTranscriptTakeover(closest)) continue
    const path = transcriptPath(node.textContent ?? '')
    if (path === undefined) {
      if (node.dataset.dcsPath !== undefined) {
        delete node.dataset.dcsPath
        node.classList.remove(MARK)
        node.removeAttribute('title')
      }
      continue
    }
    if (node.dataset.dcsPath === path) continue
    node.dataset.dcsPath = path
    node.classList.add(MARK)
    node.title = path
    node.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      openPath(path)
    })
  }
}
