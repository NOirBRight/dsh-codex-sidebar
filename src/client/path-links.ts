/** Turn transcript file paths into clicks that open Files. */

import { isTakeoverUrl } from '../browser.ts'
import { allowTranscriptTakeover } from '../transcript-takeover.ts'

const MARK = 'dcs-path-link'
const URL_HREF = '#dcs-browser'
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

export function decorate(root: ParentNode = document): void {
  decorateUrls(root)
  const nodes = root.querySelectorAll('code')
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue
    if (node.closest('.dcs-root, .dcs-col, [data-shell-overlay]')) {
      clearMark(node)
      continue
    }
    if (node.closest('a, button, [data-tool]')) {
      clearMark(node)
      continue
    }
    const closest = (selector: string) => node.closest(selector)
    if (!allowTranscriptTakeover(closest)) {
      clearMark(node)
      continue
    }
    const path = transcriptPath(node.textContent ?? '')
    if (path === undefined) {
      clearMark(node)
      continue
    }
    node.dataset.dcsPath = path
    node.classList.add(MARK)
    node.title = path
  }
}

function decorateUrls(root: ParentNode): void {
  for (const node of root.querySelectorAll('a[href]')) {
    if (!(node instanceof HTMLElement)) continue
    if (node.closest('[data-chat-flow-kind], [data-tool], [data-chat-flow]') === null) continue
    if (!allowTranscriptTakeover((selector) => node.closest(selector))) continue
    const href = (node.getAttribute('data-dcs-url') ?? node.getAttribute('href') ?? '').trim()
    if (!isTakeoverUrl(href)) continue
    node.setAttribute('data-dcs-url', href)
    const target = node.getAttribute('target')
    if (target !== null) node.setAttribute('data-dcs-target', target)
    node.setAttribute('href', URL_HREF)
    node.removeAttribute('target')
  }
}

export function pathFromClick(event: Event): string | undefined {
  const target = event.target
  if (!(target instanceof Element)) return undefined
  const code = target.closest('code.' + MARK)
  if (!(code instanceof HTMLElement)) return undefined
  const path = code.dataset.dcsPath
  return path === undefined || path.length === 0 ? undefined : path
}

function clearMark(node: HTMLElement): void {
  if (node.dataset.dcsPath === undefined) return
  delete node.dataset.dcsPath
  node.classList.remove(MARK)
  node.removeAttribute('title')
}
