/** IME composition keys must not confirm 批注 Enter. */

export function isImeKey(event: { isComposing: boolean; keyCode: number }): boolean {
  return event.isComposing || event.keyCode === 229
}
