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
  /** True when the user has text selected inside this block. */
  hasSelection: boolean
  busy: boolean
  onAction: (action: AiAction, instruction?: string) => void
  /** Escape or the close button. */
  onDismiss: () => void
}

/**
 * Floating toolbar pinned below a block, opened from that block's pencil handle. Always scoped
 * to that block (or the active selection inside it) — it never reaches other paragraphs. It stays
 * open until explicitly closed, so moving the pointer around the page never hides it.
 */
export function BlockToolbar({ top, left, hasSelection, busy, onAction, onDismiss }: BlockToolbarProps) {
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
      {hasSelection && <span className="scope-chip">selection</span>}

      {QUICK_ACTIONS.map(({ action, label, title }) => (
        <button
          key={action}
          type="button"
          title={title}
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
