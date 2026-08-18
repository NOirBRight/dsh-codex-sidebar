/** Paint +N −M on 主会话 edit/write tool rows. Plugin overlay — does not patch DSH core. */

import { statForLabel, WRITE_TOOL } from '../tool-open.ts'

const MARK = 'dcs-tool-stat'
const OBSERVE: MutationObserverInit = { childList: true, subtree: true }

export function installToolStats(getStats: () => Record<string, { added: number; removed: number }>): { stop: () => void; paint: () => void } {
  if (typeof document === 'undefined') {
    return { stop() {}, paint() { decorate(getStats()) } }
  }
  // Own writes must not be visible to this observer: a connected observer
  // plus a badge rewrite is a microtask loop that freezes the tab.
  let observer: MutationObserver
  const paint = (): void => {
    observer.disconnect()
    try {
      decorate(getStats())
    } finally {
      observer.observe(document.documentElement, OBSERVE)
    }
  }
  observer = new MutationObserver(paint)
  observer.observe(document.documentElement, OBSERVE)
  paint()
  return { stop() { observer.disconnect() }, paint }
}

export function decorate(stats: Record<string, { added: number; removed: number }>, root: ParentNode = document): void {
  const rows = root.querySelectorAll('[data-tool]')
  for (const row of rows) {
    if (!(row instanceof HTMLElement)) continue
    if (row.querySelector('[data-tool]')) continue
    const tool = row.getAttribute('data-tool') ?? ''
    if (!WRITE_TOOL.test(tool)) continue
    const label = pathLabel(row)
    const stat = label === undefined ? undefined : statForLabel(stats, label)
    const existing = row.querySelector('.' + MARK)
    if (stat === undefined) {
      existing?.remove()
      continue
    }
    const add = '+' + String(stat.added)
    const del = '−' + String(stat.removed)
    const signature = add + del
    if (existing instanceof HTMLElement) {
      if (existing.dataset.dcs === signature) continue
      existing.dataset.dcs = signature
      existing.replaceChildren(span('add', add), span('del', del))
      continue
    }
    const badge = document.createElement('span')
    badge.className = MARK
    badge.dataset.dcs = signature
    badge.append(span('add', add), span('del', del))
    const host = row.querySelector('button') ?? row
    host.insertAdjacentElement('afterend', badge) || row.append(badge)
  }
}

function pathLabel(row: HTMLElement): string | undefined {
  const texts: string[] = []
  for (const button of row.querySelectorAll('button')) {
    const text = button.textContent?.trim() ?? ''
    if (text.length === 0) continue
    if (text === '+' || text === '…' || text === '...') continue
    if (/^(edit|write|inspect|查看)$/i.test(text)) continue
    texts.push(text)
  }
  return texts.find((text) => text.includes('/') || /\.\w+$/.test(text)) ?? texts[0]
}

function span(cls: string, text: string): HTMLSpanElement {
  const node = document.createElement('span')
  node.className = cls
  node.textContent = text
  return node
}
