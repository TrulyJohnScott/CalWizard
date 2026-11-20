type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'> & { target: EventTarget | null }

/** Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y = redo. Text fields keep their own native undo. */
export function undoKey(e: KeyLike): 'undo' | 'redo' | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null
  const t = e.target as HTMLElement | null
  if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return null
  const k = e.key.toLowerCase()
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo'
  if (k === 'y' && !e.shiftKey) return 'redo'
  return null
}
