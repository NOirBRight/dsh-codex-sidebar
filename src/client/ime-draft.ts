/** Keep IME composition off the async 批注/draft RPC. */

import { useEffect, useRef, useState } from 'react'
import { isImeKey } from '../ime-key.ts'

export { isImeKey }

export function useImeSafeDraft(value: string, onCommit: (text: string) => void): {
  value: string
  onChange: (text: string) => void
  onCompositionStart: () => void
  onCompositionEnd: (text: string) => void
  flush: () => string
} {
  const [text, setText] = useState(value)
  const composing = useRef(false)
  const commit = useRef(onCommit)
  const textRef = useRef(text)
  commit.current = onCommit
  textRef.current = text

  useEffect(() => {
    if (!composing.current) setText(value)
  }, [value])

  function onChange(next: string): void {
    setText(next)
    textRef.current = next
    if (!composing.current) commit.current(next)
  }

  return {
    value: text,
    onChange,
    onCompositionStart: () => { composing.current = true },
    onCompositionEnd: (next: string) => {
      composing.current = false
      setText(next)
      textRef.current = next
      commit.current(next)
    },
    flush: () => {
      composing.current = false
      const next = textRef.current
      commit.current(next)
      return next
    },
  }
}
