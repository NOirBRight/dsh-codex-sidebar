/** Floating 批注 chip: flip/shift so it stays fully inside the pane. */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from 'react'
import { NOTE_ESTIMATE, placeNotePopover, type PlaceBox } from '../note-place.ts'
import { Ico } from './icons.tsx'
import { isImeKey, useImeSafeDraft } from './ime-draft.ts'

export function NoteComposer({
  containerRef,
  viewportRef,
  anchor,
  value,
  objectText,
  placeholder,
  sendLabel,
  addLabel,
  deleteLabel,
  editing,
  onChange,
  onAdd,
  onSend,
  onDelete,
  onDismiss,
}: {
  containerRef: RefObject<HTMLElement | null>
  viewportRef?: RefObject<HTMLElement | null>
  anchor: { x: number; y: number }
  value: string
  objectText?: string
  placeholder: string
  sendLabel: string
  addLabel: string
  deleteLabel: string
  editing?: boolean
  onChange: (text: string) => void
  onAdd: () => void
  onSend: () => void
  onDelete?: () => void
  onDismiss: () => void
}): ReactElement {
  const noteRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState({ x: anchor.x, y: anchor.y + 12 })
  const hasObject = objectText !== undefined && objectText.length > 0
  const draft = useImeSafeDraft(value, onChange)
  const add = useRef(onAdd)
  const send = useRef(onSend)
  const dismiss = useRef(onDismiss)
  const flush = useRef(draft.flush)
  add.current = onAdd
  send.current = onSend
  dismiss.current = onDismiss
  flush.current = draft.flush

  useLayoutEffect(() => {
    function place(): void {
      const origin = containerRef.current
      if (origin === null) return
      const viewEl = viewportRef?.current ?? origin
      const originBox = origin.getBoundingClientRect()
      const viewBox = viewEl.getBoundingClientRect()
      const view: PlaceBox = {
        x: viewBox.left - originBox.left,
        y: viewBox.top - originBox.top,
        w: viewBox.width,
        h: viewBox.height,
      }
      const measured = noteRef.current
      const extra = hasObject ? 8 : 0
      const popover = measured === null
        ? { w: Math.min(NOTE_ESTIMATE.w, Math.max(0, view.w - 16)), h: NOTE_ESTIMATE.h + extra }
        : { w: measured.offsetWidth, h: measured.offsetHeight }
      const next = placeNotePopover(
        { x: anchor.x, y: anchor.y, w: 0, h: 0 },
        popover,
        view,
      )
      setPos((prev) => (prev.x === next.x && prev.y === next.y ? prev : next))
    }
    place()
    const viewEl = viewportRef?.current ?? containerRef.current
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { place() })
    if (ro !== null) {
      if (viewEl !== null) ro.observe(viewEl)
      if (containerRef.current !== null) ro.observe(containerRef.current)
      if (noteRef.current !== null) ro.observe(noteRef.current)
    }
    window.addEventListener('resize', place)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [anchor.x, anchor.y, containerRef, viewportRef, objectText, hasObject])

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (isImeKey(event)) return
      const node = noteRef.current
      if (node === null) return
      const target = event.target
      if (!(target instanceof Node) || !node.contains(target)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        dismiss.current()
        return
      }
      if (event.key !== 'Enter' && event.code !== 'NumpadEnter') return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      flush.current()
      add.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [])

  return (
    <div
      ref={noteRef}
      className="dcs-note"
      data-object={hasObject ? '' : undefined}
      style={{ left: pos.x, top: pos.y }}
    >
      {hasObject && (
        <div className="dcs-note-obj" title={objectText}>
          <Ico name="inspect" size={14} />
          <span>{objectText}</span>
        </div>
      )}
      <div className="dcs-note-row">
        <input
          ref={inputRef}
          autoFocus
          value={draft.value}
          placeholder={placeholder}
          onChange={(event) => { draft.onChange(event.target.value) }}
          onCompositionStart={draft.onCompositionStart}
          onCompositionEnd={(event) => { draft.onCompositionEnd(event.currentTarget.value) }}
        />
        {editing && onDelete !== undefined && (
          <button
            type="button"
            className="dcs-note-delete"
            title={deleteLabel}
            aria-label={deleteLabel}
            onClick={onDelete}
          >
            <Ico name="trash" size={13} />
          </button>
        )}
        <button
          type="button"
          className="dcs-note-add"
          title={addLabel}
          aria-label={addLabel}
          onClick={() => { flush.current(); add.current() }}
        >
          {addLabel}
        </button>
        <button
          type="button"
          className="dcs-note-send"
          title={sendLabel}
          aria-label={sendLabel}
          onClick={() => { flush.current(); send.current() }}
        >
          <Ico name="send" size={13} />
        </button>
      </div>
    </div>
  )
}
