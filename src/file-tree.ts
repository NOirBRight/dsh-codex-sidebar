import type { TreeNode } from './session.ts'

export type TreeEntry =
  | { kind: 'dir'; path: string; name: string; depth: number; open: boolean }
  | { kind: 'file'; path: string; name: string; depth: number }

type BuiltNode = {
  path: string
  name: string
  kind: 'dir' | 'file'
  children: BuiltNode[]
}

export function ancestorsOf(path: string): Set<string> {
  const open = new Set<string>()
  const parts = path.split('/').filter((part) => part.length > 0)
  const absolute = path.startsWith('/')
  let prefix = ''
  for (let index = 0; index < parts.length - 1; index += 1) {
    prefix = prefix.length === 0
      ? (absolute ? `/${parts[index]}` : (parts[index] ?? ''))
      : `${prefix}/${parts[index]}`
    if (prefix.length > 0) open.add(prefix)
  }
  return open
}

export function visibleTree(
  nodes: readonly TreeNode[],
  expanded: Set<string>,
  query: string,
): TreeEntry[] {
  const needle = query.trim().toLowerCase()
  const tree = needle.length === 0 ? buildTree(nodes) : filterTree(buildTree(nodes), needle)
  const open = new Set(expanded)
  if (needle.length > 0) collectDirs(tree, open)
  return flatten(tree, open, 0)
}

function filterTree(nodes: readonly BuiltNode[], needle: string): BuiltNode[] {
  const out: BuiltNode[] = []
  for (const node of nodes) {
    if (node.kind === 'file') {
      if (node.name.toLowerCase().includes(needle) || node.path.toLowerCase().includes(needle)) out.push(node)
      continue
    }
    const children = filterTree(node.children, needle)
    if (children.length > 0 || node.name.toLowerCase().includes(needle)) {
      out.push({ ...node, children })
    }
  }
  return out
}

function collectDirs(nodes: readonly BuiltNode[], open: Set<string>): void {
  for (const node of nodes) {
    if (node.kind !== 'dir') continue
    open.add(node.path)
    collectDirs(node.children, open)
  }
}

function buildTree(nodes: readonly TreeNode[]): BuiltNode[] {
  const root: BuiltNode[] = []
  const dirs = new Map<string, BuiltNode>()

  function ensureDir(path: string): BuiltNode[] {
    if (path.length === 0) return root
    const held = dirs.get(path)
    if (held !== undefined) return held.children
    const slash = path.lastIndexOf('/')
    const name = slash === -1 ? path : path.slice(slash + 1)
    const parent = slash === -1 ? '' : path.slice(0, slash)
    const node: BuiltNode = { path, name, kind: 'dir', children: [] }
    dirs.set(path, node)
    ensureDir(parent).push(node)
    return node.children
  }

  for (const node of nodes) {
    if (node.kind === 'dir') {
      ensureDir(node.path)
      continue
    }
    const slash = node.path.lastIndexOf('/')
    const parent = slash === -1 ? '' : node.path.slice(0, slash)
    ensureDir(parent).push({
      path: node.path,
      name: node.name,
      kind: 'file',
      children: [],
    })
  }

  sortLevel(root)
  return root
}

function sortLevel(list: BuiltNode[]): void {
  list.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })
  for (const child of list) sortLevel(child.children)
}

function flatten(nodes: readonly BuiltNode[], open: Set<string>, depth: number): TreeEntry[] {
  const out: TreeEntry[] = []
  for (const node of nodes) {
    if (node.kind === 'dir') {
      const isOpen = open.has(node.path)
      out.push({ kind: 'dir', path: node.path, name: node.name, depth, open: isOpen })
      if (isOpen) out.push(...flatten(node.children, open, depth + 1))
    } else {
      out.push({ kind: 'file', path: node.path, name: node.name, depth })
    }
  }
  return out
}
