import { useState } from 'react'
import type { AiAction } from '../../shared/contract'

const QUICK_ACTIONS: Array<{ action: AiAction; label: string; title: string }> = [
  { action: 'rewrite', label: 'Rewrite', title: 'Rewrite this paragraph' },
  { action: 'shorten', label: 'Shorten', title: 'Make it tighter' },
  { action: 'expand', label: 'Expand', title: 'Add supporting detail' },
  { action: 'set_tone', label: 'Fix tone', title: 'Smooth out the tone' },
]

export interface BlockToolbarProps {
  /** Screen-space anchor of the hovered block, relative to the editor shell. */
  top: number
  left: number
  /** True when the user has text selected inside this block. */
  hasSelection: boolean
  busy: boolean
  onAction: (action: AiAction, instruction?: string) => void
  onDismiss: () => void
  /** Pointer entered / left the toolbar itself, so the parent can run its hide timer. */
  onPointerEnter: () => void
  onPointerLeave: () => void
}

/**
 * Floating toolbar pinned below the hovered block. Always scoped to that block
 * (or the active selection inside it) — it never reaches other paragraphs.
 */
export function BlockToolbar({
  top,
  left,
  hasSelection,
  busy,
  onAction,
  onDismiss,
  onPointerEnter,
  onPointerLeave,
}: BlockToolbarProps) {
  const [instruction, setInstruction] = useState('')

  function submitInstruction() {
    const trimmed = instruction.trim()
    if (!trimmed) return
    setInstruction('')
    onAction('rewrite', trimmed)
  }

  return (
    <div
      className="block-toolbar"
      style={{ top, left }}
      // Keep the toolbar alive while the pointer is on it, not just on the block. Moves over
      // the toolbar must not reach the paper's hit-testing, which would retarget the hover.
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onMouseMove={(event) => event.stopPropagation()}
      onMouseLeave={(event) => event.stopPropagation()}
    >
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
        onChange={(event) => setInstruction(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            submitInstruction()
          } else if (event.key === 'Escape') {
            onDismiss()
          }
        }}
      />
    </div>
  )
}
