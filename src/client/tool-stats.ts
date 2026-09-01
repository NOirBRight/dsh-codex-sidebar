/** Paint +N −M after the filename on each 主会话 edit/write tool row. */

import { queueRowStats, takeRowHunk, WRITE_TOOL, type OpenHunk, type RowStat } from '../tool-open.ts'

const MARK = 'dcs-tool-stat'

export type ToolRowHunk = Pick<OpenHunk, 'before' | 'after'>

const rowHunks = new WeakMap<HTMLElement, ToolRowHunk>()

/** Return the exact transcript hunk bound to one rendered host tool row. */
export function hunkForToolRow(row: HTMLElement): ToolRowHunk | undefined {
  return rowHunks.get(row)
}

export function decorate(stats: readonly RowStat[], root: ParentNode = document): void {
  const pending = queueRowStats(stats)
  const rows = root.querySelectorAll('[data-tool]')
  for (const row of rows) {
    if (!(row instanceof HTMLElement)) continue
    if (row.querySelector('[data-tool]')) continue
    const tool = row.getAttribute('data-tool') ?? ''
    if (!WRITE_TOOL.test(tool)) continue
    const pathBtn = pathButton(row)
    const label = pathBtn === undefined ? pathLabel(row) : pathText(pathBtn)
    const stat = label === undefined ? undefined : takeRowHunk(pending, label)
    if (stat?.before === undefined || stat.after === undefined) rowHunks.delete(row)
    else rowHunks.set(row, { before: stat.before, after: stat.after })
    if (stat?.hunkId === undefined) delete row.dataset.dcsHunkId
    else row.dataset.dcsHunkId = stat.hunkId
    const existing = row.querySelector('.' + MARK)
    if (stat === undefined || (stat.added === 0 && stat.removed === 0)) {
      existing?.remove()
      continue
    }
    const add = '+' + String(stat.added)
    const del = '−' + String(stat.removed)
    const signature = add + del
    if (existing instanceof HTMLElement) {
      if (existing.dataset.dcs === signature) {
        placeStat(existing, pathBtn, row)
        continue
      }
      existing.dataset.dcs = signature
      existing.replaceChildren(span('add', add), span('del', del))
      placeStat(existing, pathBtn, row)
      continue
    }
    const badge = document.createElement('span')
    badge.className = MARK
    badge.dataset.dcs = signature
    badge.append(span('add', add), span('del', del))
    placeStat(badge, pathBtn, row)
  }
}

function placeStat(badge: HTMLElement, pathBtn: HTMLElement | undefined, row: HTMLElement): void {
  if (pathBtn !== undefined) {
    if (badge.parentElement !== pathBtn) pathBtn.append(badge)
    return
  }
  if (badge.parentElement !== row) row.append(badge)
}

function pathButton(row: HTMLElement): HTMLElement | undefined {
  for (const button of row.querySelectorAll('button')) {
    const text = pathText(button)
    if (text.length === 0) continue
    if (text === '+' || text === '…' || text === '...') continue
    if (/^(edit|write|inspect|查看)$/i.test(text)) continue
    if (text.includes('/') || /\.\w+$/.test(text)) return button
  }
  return undefined
}

function pathLabel(row: HTMLElement): string | undefined {
  const texts: string[] = []
  for (const button of row.querySelectorAll('button')) {
    const text = pathText(button)
    if (text.length === 0) continue
    if (text === '+' || text === '…' || text === '...') continue
    if (/^(edit|write|inspect|查看)$/i.test(text)) continue
    texts.push(text)
  }
  return texts.find((text) => text.includes('/') || /\.\w+$/.test(text)) ?? texts[0]
}

function pathText(el: HTMLElement): string {
  const mark = el.querySelector('.' + MARK)
  const full = el.textContent ?? ''
  if (!(mark instanceof HTMLElement)) return full.trim()
  return full.replace(mark.textContent ?? '', '').trim()
}

function span(cls: string, text: string): HTMLSpanElement {
  const node = document.createElement('span')
  node.className = cls
  node.textContent = text
  return node
}
