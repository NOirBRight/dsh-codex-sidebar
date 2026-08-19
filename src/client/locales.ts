/** Copy for the 侧栏 chrome. */

export const NS = 'codex-sidebar'

export const en = {
  toggleShow: 'Show sidebar',
  toggleHide: 'Hide sidebar',
  resizeDrawer: 'Resize sidebar',
  newTab: 'New tab',
  closeTab: 'Close tab',
  annotate: 'Note',
  openTree: 'Show file tree',
  closeTree: 'Hide file tree',
  filesPreview: 'Preview',
  filesDiff: 'Diff',
  notePlaceholder: 'Add a note for this session',
  noteSend: 'Send',
  noteAdd: 'Add',
  noteDelete: 'Delete note',
  sendAnnotations: 'Send annotations',
  later: 'This tool arrives in a later ticket.',
  newTerminal: 'New terminal',
  collapseTerminals: 'Hide terminals',
  expandTerminals: 'Show terminals',
} as const

export type SidebarKey = keyof typeof en

export const zh: Record<SidebarKey, string> = {
  toggleShow: '显示侧栏',
  toggleHide: '隐藏侧栏',
  resizeDrawer: '调整侧栏宽度',
  newTab: '新 Tab',
  closeTab: '关闭 Tab',
  annotate: '批注',
  openTree: '打开文件树',
  closeTree: '关闭文件树',
  filesPreview: '预览',
  filesDiff: 'Diff',
  notePlaceholder: '给当前会话留一条批注',
  noteSend: '发送',
  noteAdd: '新增',
  noteDelete: '删除批注',
  sendAnnotations: '发送批注',
  later: '这个工具会在后续票里接上。',
  newTerminal: '新建终端',
  collapseTerminals: '收起终端列表',
  expandTerminals: '展开终端列表',
}
