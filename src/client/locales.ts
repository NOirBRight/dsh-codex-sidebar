/** Copy for the 侧栏 chrome. */

export const NS = 'codex-sidebar'

export const en = {
  toggleShow: 'Show 侧栏',
  toggleHide: 'Hide 侧栏',
  newTab: 'New tab',
  closeTab: 'Close tab',
  annotate: '批注',
  openTree: '打开文件列表',
  closeTree: '关闭列表',
  notePlaceholder: '批注给舵主',
  later: 'This 工具 arrives in a later ticket.',
} as const

export type SidebarKey = keyof typeof en

export const zh: Record<SidebarKey, string> = {
  toggleShow: '显示侧栏',
  toggleHide: '隐藏侧栏',
  newTab: '新 Tab',
  closeTab: '关闭 Tab',
  annotate: '批注',
  openTree: '打开文件列表',
  closeTree: '关闭列表',
  notePlaceholder: '批注给舵主',
  later: '这个工具会在后续票里接上。',
}
