/** Prototype-faithful icons. Stroke follows currentColor so the host theme paints them. */

import type { ReactElement } from 'react'

export type IconName =
  | 'review' | 'terminal' | 'globe' | 'folder' | 'chat' | 'panel'
  | 'plus' | 'x' | 'pencil' | 'tree' | 'file' | 'search' | 'chevron'
  | 'back' | 'fwd' | 'refresh' | 'external' | 'file-plus' | 'folder-plus' | 'more'
  | 'inspect' | 'send' | 'enter'

export function Ico({ name, size = 16 }: { name: IconName; size?: number }): ReactElement {
  const p = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  }
  switch (name) {
    case 'review':
      return <svg {...p}><rect x="4.5" y="4.5" width="15" height="15" rx="2.5" /><path d="M12 8.5v7M8.5 12h7" /></svg>
    case 'terminal':
      return <svg {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M7.5 9.5l3 2.5-3 2.5M12.5 14.5h4" /></svg>
    case 'globe':
      return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.4 3.2 2.4 14.8 0 18M12 3c-2.4 3.2-2.4 14.8 0 18" /></svg>
    case 'folder':
      return <svg {...p}><path d="M3.5 8h5.2l1.8 2H20.5v9.5H3.5z" /><path d="M3.5 8V6.4A1.4 1.4 0 014.9 5h3.6l1.5 1.6" /></svg>
    case 'chat':
      return <svg {...p}><path d="M20.2 11.2a7.4 7.4 0 01-8.1 7.4L6 21.2l.7-3.3A7.4 7.4 0 1119.6 8" /><path d="M12 9v5M9.5 11.5h5" /></svg>
    case 'panel':
      return <svg {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M15.5 4.5v15" /></svg>
    case 'plus':
      return <svg {...p}><path d="M12 6v12M6 12h12" /></svg>
    case 'x':
      return <svg {...p}><path d="M7 7l10 10M17 7L7 17" /></svg>
    case 'pencil':
      return (
        <svg {...p}>
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          <path d="m15 5 4 4" />
        </svg>
      )
    case 'tree':
      return <svg {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M14.5 4.5v15" /><path d="M16.4 8.5h2.2M16.4 12h2.2M16.4 15.5h2.2" /></svg>
    case 'file':
      return <svg {...p}><path d="M7 4.5h7l4 4V19.5H7z" /><path d="M14 4.5V9h4.5" /></svg>
    case 'search':
      return <svg {...p}><circle cx="11" cy="11" r="6" /><path d="M16 16l4 4" /></svg>
    case 'chevron':
      return <svg {...p}><path d="M9 6l6 6-6 6" /></svg>
    case 'back':
      return <svg {...p}><path d="M14.5 6l-6 6 6 6" /></svg>
    case 'fwd':
      return <svg {...p}><path d="M9.5 6l6 6-6 6" /></svg>
    case 'refresh':
      return <svg {...p}><path d="M21 12a9 9 0 11-3.2-6.9" /><path d="M21 3v6h-6" /></svg>
    case 'external':
      return <svg {...p}><path d="M14 5h5v5M19 5l-8.5 8.5" /><path d="M11 6.5H6.8A1.3 1.3 0 005.5 7.8v9.4A1.3 1.3 0 006.8 18.5h9.4a1.3 1.3 0 001.3-1.3V13" /></svg>
    case 'file-plus':
      return <svg {...p}><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5" /><path d="M12 18v-6M9 15h6" /></svg>
    case 'folder-plus':
      return <svg {...p}><path d="M3 19.5h18a1.5 1.5 0 001.5-1.5V8.5A1.5 1.5 0 0021 7h-7.6a1.5 1.5 0 01-1.2-.6L10.8 4.6A1.5 1.5 0 009.6 4H3a1.5 1.5 0 00-1.5 1.5v12A1.5 1.5 0 003 19.5z" /><path d="M12 10.5v6M9 13.5h6" /></svg>
    case 'more':
      return <svg {...p}><circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none" /></svg>
    case 'inspect':
      return <svg {...p}><rect x="4.5" y="4.5" width="11" height="11" rx="1.5" /><path d="M12 12l6 6" /><path d="M15.5 18.5h3v-3" /></svg>
    case 'send':
      return <svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
    case 'enter':
      return <svg {...p}><path d="M20 5v6a3 3 0 0 1-3 3H5" /><path d="M9 10l-4 4 4 4" /></svg>
  }
}

export function tabIcon(kind: string | null): IconName {
  if (kind === 'Review') return 'review'
  if (kind === 'Terminal') return 'terminal'
  if (kind === 'Browser') return 'globe'
  if (kind === 'Files') return 'folder'
  return 'file'
}

export function FileGlyph({ name }: { name: string }): ReactElement {
  const { stroke, mark } = glyphFor(name)
  return (
    <svg
      className="dcs-fglyph"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke={stroke}
      strokeWidth="1.15"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4.5 2.75h5.1L12 5.2V13.25H4.5z" />
      <path d="M9.4 2.75V5.4H12" />
      {mark.length > 0 && (
        <text
          x="8"
          y="11.1"
          textAnchor="middle"
          fill="none"
          stroke={stroke}
          strokeWidth="0.55"
          style={{ fontSize: mark.length > 1 ? 4.4 : 5.2, fontWeight: 600, letterSpacing: '-0.04em' }}
        >
          {mark}
        </text>
      )}
    </svg>
  )
}

function glyphFor(name: string): { stroke: string; mark: string } {
  const lower = name.toLowerCase()
  const muted = 'var(--dsw-alias-label-tertiary)'
  if (lower === '.gitignore' || lower === '.gitattributes' || lower.endsWith('.gitkeep')) {
    return { stroke: '#b56a5c', mark: '' }
  }
  if (
    lower === 'package.json' || lower === 'package-lock.json' || lower === 'pnpm-lock.yaml'
    || lower === '.npmrc' || lower === 'yarn.lock' || lower === 'npm-shrinkwrap.json'
  ) {
    return { stroke: '#b06a68', mark: 'n' }
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return { stroke: '#7a8f9c', mark: 'M' }
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return { stroke: '#9a8d62', mark: 'Y' }
  if (lower.endsWith('.tsx') || lower.endsWith('.ts')) return { stroke: '#6d86a3', mark: 'TS' }
  if (lower.endsWith('.jsx') || lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return { stroke: '#9a9358', mark: 'JS' }
  }
  if (lower.endsWith('.css')) return { stroke: '#7d7190', mark: 'C' }
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return { stroke: '#b07a68', mark: 'H' }
  if (lower.endsWith('.json')) return { stroke: '#9a9358', mark: '{}' }
  if (lower.endsWith('.svg') || /\.(png|jpe?g|gif|webp)$/i.test(lower)) return { stroke: '#8a7a9a', mark: '' }
  return { stroke: muted, mark: '' }
}
