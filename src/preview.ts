/** Read-only Files preview: Markdown blocks and code tokens. No HTML in, no HTML out. */

export type TokenKind = 'kw' | 'str' | 'com' | 'num' | 'punc' | 'text'
export type Token = { kind: TokenKind; text: string }

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'link'; text: string; href: string }

export type MdBlock =
  | { type: 'h'; level: 1 | 2 | 3; line: number; inlines: Inline[] }
  | { type: 'p'; line: number; inlines: Inline[] }
  | { type: 'ul'; line: number; items: Inline[][] }
  | { type: 'ol'; line: number; items: Inline[][] }
  | { type: 'quote'; line: number; inlines: Inline[] }
  | { type: 'code'; line: number; lang: string; text: string }
  | { type: 'hr'; line: number }

export type PreviewKind = 'markdown' | 'code' | 'text'

const TS_KW = new Set([
  'export', 'import', 'from', 'default', 'function', 'return', 'const', 'let', 'var',
  'class', 'extends', 'implements', 'interface', 'type', 'enum', 'if', 'else', 'for',
  'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'this', 'super', 'typeof',
  'instanceof', 'in', 'of', 'as', 'satisfies', 'async', 'await', 'try', 'catch', 'finally',
  'throw', 'void', 'null', 'undefined', 'true', 'false', 'yield', 'delete', 'debugger',
  'public', 'private', 'protected', 'readonly', 'static', 'abstract', 'declare', 'module',
  'namespace', 'keyof', 'infer', 'never', 'unknown', 'any', 'boolean', 'number', 'string',
  'symbol', 'bigint', 'unique', 'asserts', 'is', 'with', 'package',
])

const PY_KW = new Set([
  'def', 'class', 'return', 'import', 'from', 'as', 'if', 'elif', 'else', 'for', 'while',
  'try', 'except', 'finally', 'raise', 'with', 'yield', 'lambda', 'pass', 'break', 'continue',
  'and', 'or', 'not', 'in', 'is', 'None', 'True', 'False', 'async', 'await', 'global',
  'nonlocal', 'assert', 'del',
])

const GO_KW = new Set([
  'func', 'package', 'import', 'return', 'var', 'const', 'type', 'struct', 'interface',
  'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'break', 'continue', 'go',
  'defer', 'select', 'map', 'chan', 'nil', 'true', 'false',
])

const RS_KW = new Set([
  'fn', 'let', 'mut', 'const', 'pub', 'use', 'mod', 'struct', 'enum', 'impl', 'trait',
  'return', 'if', 'else', 'match', 'for', 'while', 'loop', 'break', 'continue', 'async',
  'await', 'true', 'false', 'self', 'Self', 'crate', 'super', 'where', 'type',
])

const SH_KW = new Set([
  'if', 'then', 'else', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'in',
  'function', 'return', 'local', 'export', 'source', 'shift',
])

const KW: Record<string, Set<string>> = {
  ts: TS_KW,
  py: PY_KW,
  go: GO_KW,
  rs: RS_KW,
  sh: SH_KW,
}

export function extOf(path: string): string {
  const base = path.split('/').pop() ?? path
  const dot = base.lastIndexOf('.')
  return dot === -1 ? '' : base.slice(dot + 1).toLowerCase()
}

export function previewKind(path: string): PreviewKind {
  const ext = extOf(path)
  if (ext === 'md' || ext === 'mdx' || ext === 'markdown') return 'markdown'
  if (langOf(path) !== 'text') return 'code'
  return 'text'
}

export function langOf(path: string): string {
  const ext = extOf(path)
  if (ext === 'tsx' || ext === 'ts' || ext === 'jsx' || ext === 'js' || ext === 'mjs' || ext === 'cjs') return 'ts'
  if (ext === 'py') return 'py'
  if (ext === 'go') return 'go'
  if (ext === 'rs') return 'rs'
  if (ext === 'json') return 'json'
  if (ext === 'css' || ext === 'scss') return 'css'
  if (ext === 'html' || ext === 'htm' || ext === 'svg') return 'html'
  if (ext === 'sh' || ext === 'bash' || ext === 'zsh') return 'sh'
  if (ext === 'yml' || ext === 'yaml') return 'yaml'
  if (ext === 'md' || ext === 'mdx' || ext === 'markdown') return 'md'
  return 'text'
}

export function highlightSource(path: string, source: string): Token[][] {
  const lang = langOf(path)
  const keywords = KW[lang] ?? new Set<string>()
  const hash = lang === 'py' || lang === 'sh' || lang === 'yaml'
  const slash = lang === 'ts' || lang === 'go' || lang === 'rs' || lang === 'css' || lang === 'json' || lang === 'md'
  const block = lang === 'ts' || lang === 'go' || lang === 'rs' || lang === 'css'
  const html = lang === 'html'
  const out: Token[][] = []
  let inBlock = false
  let inHtmlCom = false
  for (const line of source.split('\n')) {
    const row: Token[] = []
    let i = 0
    const push = (kind: TokenKind, text: string): void => {
      if (text.length === 0) return
      const last = row[row.length - 1]
      if (last && last.kind === kind) last.text += text
      else row.push({ kind, text })
    }
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf('*/', i)
        if (end === -1) {
          push('com', line.slice(i))
          i = line.length
          break
        }
        push('com', line.slice(i, end + 2))
        i = end + 2
        inBlock = false
        continue
      }
      if (inHtmlCom) {
        const end = line.indexOf('-->', i)
        if (end === -1) {
          push('com', line.slice(i))
          i = line.length
          break
        }
        push('com', line.slice(i, end + 3))
        i = end + 3
        inHtmlCom = false
        continue
      }
      const rest = line.slice(i)
      if (block && rest.startsWith('/*')) {
        inBlock = true
        continue
      }
      if (html && rest.startsWith('<!--')) {
        inHtmlCom = true
        continue
      }
      if (slash && rest.startsWith('//')) {
        push('com', rest)
        break
      }
      if (hash && rest.startsWith('#')) {
        push('com', rest)
        break
      }
      const quote = rest[0]
      if (quote === '"' || quote === "'" || (quote === '`' && lang === 'ts')) {
        const eaten = readString(line, i, quote)
        push('str', line.slice(i, eaten.end))
        i = eaten.end
        continue
      }
      if (isDigit(line[i] ?? '')) {
        let j = i + 1
        while (isDigit(line[j] ?? '') || line[j] === '.' || line[j] === '_') j += 1
        push('num', line.slice(i, j))
        i = j
        continue
      }
      if (isIdentStart(line[i] ?? '')) {
        let j = i + 1
        while (isIdent(line[j] ?? '')) j += 1
        const word = line.slice(i, j)
        push(keywords.has(word) ? 'kw' : 'text', word)
        i = j
        continue
      }
      const ch = line[i] ?? ''
      if ('(){}[]<>=!+-*%&|^~?:;,.'.includes(ch)) {
        push('punc', ch)
        i += 1
        continue
      }
      push('text', ch)
      i += 1
    }
    out.push(row)
  }
  return out
}

function readString(line: string, start: number, quote: string): { end: number } {
  let i = start + 1
  while (i < line.length) {
    const ch = line[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === quote) return { end: i + 1 }
    i += 1
  }
  return { end: line.length }
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}

function isIdentStart(ch: string): boolean {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_' || ch === '$'
}

function isIdent(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch)
}

export function parseMarkdown(source: string): MdBlock[] {
  const raw = source.split('\n')
  const blocks: MdBlock[] = []
  let i = 0
  while (i < raw.length) {
    const line = raw[i] ?? ''
    const lineNo = i + 1
    if (/^\s*$/.test(line)) {
      i += 1
      continue
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'hr', line: lineNo })
      i += 1
      continue
    }
    const fence = line.match(/^\s*```(\w*)\s*$/)
    if (fence) {
      const lang = fence[1] ?? ''
      const body: string[] = []
      i += 1
      while (i < raw.length && !/^\s*```\s*$/.test(raw[i] ?? '')) {
        body.push(raw[i] ?? '')
        i += 1
      }
      if (i < raw.length) i += 1
      blocks.push({ type: 'code', line: lineNo, lang, text: body.join('\n') })
      continue
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      const marks = heading[1] ?? '#'
      const level = Math.min(marks.length, 3) as 1 | 2 | 3
      blocks.push({ type: 'h', level, line: lineNo, inlines: parseInlines(heading[2] ?? '') })
      i += 1
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      blocks.push({ type: 'quote', line: lineNo, inlines: parseInlines(line.replace(/^\s*>\s?/, '')) })
      i += 1
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: Inline[][] = []
      const start = lineNo
      while (i < raw.length && /^\s*[-*]\s+/.test(raw[i] ?? '')) {
        items.push(parseInlines((raw[i] ?? '').replace(/^\s*[-*]\s+/, '')))
        i += 1
      }
      blocks.push({ type: 'ul', line: start, items })
      continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: Inline[][] = []
      const start = lineNo
      while (i < raw.length && /^\s*\d+\.\s+/.test(raw[i] ?? '')) {
        items.push(parseInlines((raw[i] ?? '').replace(/^\s*\d+\.\s+/, '')))
        i += 1
      }
      blocks.push({ type: 'ol', line: start, items })
      continue
    }
    const para: string[] = [line]
    const start = lineNo
    i += 1
    while (i < raw.length) {
      const next = raw[i] ?? ''
      if (/^\s*$/.test(next)) break
      if (/^(#{1,3})\s+/.test(next) || /^\s*[-*]\s+/.test(next) || /^\s*\d+\.\s+/.test(next)) break
      if (/^\s*>\s?/.test(next) || /^\s*```/.test(next) || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(next)) break
      para.push(next)
      i += 1
    }
    blocks.push({ type: 'p', line: start, inlines: parseInlines(para.join(' ')) })
  }
  return blocks
}

export function parseInlines(input: string): Inline[] {
  const out: Inline[] = []
  const pushText = (text: string): void => {
    if (text.length === 0) return
    const last = out[out.length - 1]
    if (last && last.kind === 'text') last.text += text
    else out.push({ kind: 'text', text })
  }
  let i = 0
  while (i < input.length) {
    const rest = input.slice(i)
    const code = rest.match(/^`([^\`]+)`/)
    if (code) {
      out.push({ kind: 'code', text: code[1] ?? '' })
      i += code[0].length
      continue
    }
    const link = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/)
    if (link) {
      out.push({ kind: 'link', text: link[1] ?? '', href: link[2] ?? '' })
      i += link[0].length
      continue
    }
    const strong = rest.match(/^\*\*([^*]+)\*\*/)
    if (strong) {
      out.push({ kind: 'strong', text: strong[1] ?? '' })
      i += strong[0].length
      continue
    }
    const em = rest.match(/^\*([^*]+)\*/)
    if (em) {
      out.push({ kind: 'em', text: em[1] ?? '' })
      i += em[0].length
      continue
    }
    pushText(input[i] ?? '')
    i += 1
  }
  return out
}
