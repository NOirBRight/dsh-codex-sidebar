/** Prototype-faithful icons. Stroke follows currentColor so the host theme paints them. */

import type { ReactElement } from 'react'

export type IconName =
  | 'review' | 'terminal' | 'globe' | 'folder' | 'chat' | 'panel'
  | 'plus' | 'x' | 'pencil' | 'tree' | 'file'
  | 'back' | 'fwd' | 'refresh' | 'external'

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
      return <svg {...p}><path d="M14 6.5l3.5 3.5L8 19.5H4.5V16z" /><path d="M12.5 8l3.5 3.5" /></svg>
    case 'tree':
      return <svg {...p}><path d="M5 6h6M5 12h10M5 18h8" /></svg>
    case 'file':
      return <svg {...p}><path d="M7 4.5h7l4 4V19.5H7z" /><path d="M14 4.5V9h4.5" /></svg>
    case 'back':
      return <svg {...p}><path d="M14.5 6l-6 6 6 6" /></svg>
    case 'fwd':
      return <svg {...p}><path d="M9.5 6l6 6-6 6" /></svg>
    case 'refresh':
      return <svg {...p}><path d="M20 12a8 8 0 10-2.3 5.5" /><path d="M20 12V6.8M20 12h-5.2" /></svg>
    case 'external':
      return <svg {...p}><path d="M14 5h5v5M19 5l-8.5 8.5" /><path d="M11 6.5H6.8A1.3 1.3 0 005.5 7.8v9.4A1.3 1.3 0 006.8 18.5h9.4a1.3 1.3 0 001.3-1.3V13" /></svg>
  }
}

export function tabIcon(kind: string | null): IconName {
  if (kind === 'Review') return 'review'
  if (kind === 'Terminal') return 'terminal'
  if (kind === 'Browser') return 'globe'
  if (kind === 'Files') return 'folder'
  if (kind === 'Side Chat') return 'chat'
  return 'file'
}
