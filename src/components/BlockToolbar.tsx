import { useEffect, useState } from 'react'
import type { AiAction } from '../../shared/contract/aiAction'

const QUICK_ACTIONS: Array<{ action: AiAction; label: string; title: string }> = [
  { action: 'rewrite', label: 'Rewrite', title: 'Rewrite this paragraph' },
  { action: 'shorten', label: 'Shorten', title: 'Make it tighter' },
  { action: 'expand', label: 'Expand', title: 'Add supporting detail' },
  { action: 'set_tone', label: 'Fix tone', title: 'Smooth out the tone' },
]

export interface BlockToolbarProps {
  /** Screen-space anchor of the target block, relative to the editor shell. */
  top: number
  left: number
  /** How many blocks the actions go to. They are highlighted in the editor, not listed here. */
  blockCount: number
  busy: boolean
  onAction: (action: AiAction, instruction?: string) => void
  /** Escape or the close button. */
  onDismiss: () => void
}

/**
 * Floating toolbar pinned below its target, opened from the pencil handle. Always scoped to the
 * highlighted blocks (or the span selected inside a single one) — it never reaches other
 * paragraphs. It stays open until explicitly closed, so moving the pointer never hides it.
 */
export function BlockToolbar({ top, left, blockCount, busy, onAction, onDismiss }: BlockToolbarProps) {
  const [instruction, setInstruction] = useState('')

  // Escape closes the toolbar wherever focus is — the instruction input or the editor itself.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onDismiss()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onDismiss])

  function submitInstruction() {
    const trimmed = instruction.trim()
    if (!trimmed) return
    setInstruction('')
    onAction('rewrite', trimmed)
  }

  return (
    <div className="block-toolbar" style={{ top, left }}>
      {QUICK_ACTIONS.map(({ action, label, title }) => (
        <button
          key={action}
          type="button"
          title={blockCount > 1 ? `${title} — all ${blockCount} highlighted blocks` : title}
          disabled={busy}
          onClick={() => onAction(action)}
        >
          {label}
        </button>
      ))}

      <input
        className="instruction-input"
        placeholder="Tell the AI what to change…"
        value={instruction}
        disabled={busy}
        autoFocus
        onChange={(event) => setInstruction(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            submitInstruction()
          }
        }}
      />

      <button type="button" className="close" title="Close (Esc)" aria-label="Close" onClick={onDismiss}>
        ×
      </button>
    </div>
  )
}
