/** User/steering bubble that hides 批注 evidence and shows clickable chips. */

import { useEffect, useState, type ReactNode } from 'react'
import { annotationMarksFromSource, hydrateAnnotation, type AnnotationMarkView } from '../annotation.ts'
import { contentImages, firstTextBlock } from '../annotation-message.ts'
import type { Annotation } from '../session.ts'
import type { SidebarController } from './controller.ts'
import { Ico } from './icons.tsx'
import type { SidebarKey } from './locales.ts'

export function UserAnnotationBubble(props: {
  node: { data: { content: readonly unknown[]; source: unknown; time: number } }
  loadImage?: (attachment: { attachmentId: string }) => Promise<string>
  sessionId: string
  controller: SidebarController
  t: (key: SidebarKey, params?: Record<string, unknown>) => string
}): ReactNode {
  const { node, loadImage, sessionId, controller, t } = props
  const marks = annotationMarksFromSource(node.data.source)
  const human = firstTextBlock(node.data.content)
  if (marks === undefined) {
    return <PlainUserBubble content={node.data.content} loadImage={loadImage} t={t} />
  }
  return (
    <div className="dcs-user-row">
      <div className="dcs-user-stack">
        <div className="dcs-user-bubble">
          {human.length > 0 && <div className="dcs-user-text">{human}</div>}
          <div className="dcs-msg-chips">
            {marks.map((mark, index) => (
              <button
                key={mark.id}
                type="button"
                className="dcs-chip dcs-msg-chip"
                aria-label={t('openMark', { n: index + 1, from: mark.from })}
                onClick={() => { void controller.dispatch(String(sessionId), { type: 'reveal-mark', mark: markToAnnotation(mark) }) }}
              >
                <span className="dcs-chip-n">{index + 1}</span>
                <span className="dcs-chip-from">{mark.from}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <CopyButton text={human} label={t('copyMessage')} />
    </div>
  )
}

function PlainUserBubble({
  content,
  loadImage,
  t,
}: {
  content: readonly unknown[]
  loadImage?: (attachment: { attachmentId: string }) => Promise<string>
  t: (key: SidebarKey, params?: Record<string, unknown>) => string
}): ReactNode {
  const text = firstTextBlock(content)
  const rest = content.filter((block) => {
    if (typeof block !== 'object' || block === null) return false
    const rec = block as { type?: unknown; text?: unknown }
    return rec.type === 'text' && typeof rec.text === 'string' && rec.text !== text
  }) as Array<{ type: 'text'; text: string }>
  const body = [text, ...rest.map((block) => block.text)].filter((part) => part.length > 0).join('\n')
  const images = contentImages(content)
  return (
    <div className="dcs-user-row">
      <div className="dcs-user-stack">
        {loadImage !== undefined && images.length > 0 && <FallbackImages images={images} load={loadImage} />}
        {body.length > 0 && <div className="dcs-user-bubble"><div className="dcs-user-text">{body}</div></div>}
      </div>
      <CopyButton text={body} label={t('copyMessage')} />
    </div>
  )
}

function FallbackImages({
  images,
  load,
}: {
  images: Array<{ attachmentId: string }>
  load: (attachment: { attachmentId: string }) => Promise<string>
}): ReactNode {
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    void Promise.all(images.map((image) => load(image))).then((next) => {
      if (!cancelled) setUrls(next)
    }, () => {
      if (!cancelled) setUrls([])
    })
    return () => { cancelled = true }
  }, [images, load])
  if (urls.length === 0) return null
  return (
    <div className="dcs-user-images">
      {urls.map((src, index) => (
        <img key={src + String(index)} src={src} alt="" className="dcs-user-thumb" />
      ))}
    </div>
  )
}

function CopyButton({ text, label }: { text: string; label: string }): ReactNode {
  if (text.length === 0) return null
  return (
    <button
      type="button"
      className="dcs-user-copy"
      aria-label={label}
      onClick={() => { void navigator.clipboard?.writeText(text) }}
    >
      <Ico name="file" size={14} />
    </button>
  )
}

function markToAnnotation(mark: AnnotationMarkView): Annotation {
  return hydrateAnnotation({
    id: mark.id,
    from: mark.from,
    source: mark.source,
    ...mark.selector === undefined ? {} : { selector: mark.selector },
    ...mark.path === undefined ? {} : { path: mark.path },
    ...mark.line === undefined ? {} : { line: mark.line },
    ...mark.url === undefined ? {} : { url: mark.url },
    ...mark.rect === undefined ? {} : { rect: mark.rect },
    ...mark.selection === undefined ? {} : { selection: mark.selection },
  })
}
