import { useState } from 'react'

import { TONE_PRESETS } from '../../shared/contract/aiAction'
import type { TonePreset } from '../../shared/contract/aiAction'

const TONE_LABELS: Record<TonePreset, string> = {
  formal: 'Formal',
  casual: 'Casual',
  concise: 'Concise',
  persuasive: 'Persuasive',
  friendly: 'Friendly',
}

interface TopToolbarProps {
  aiEnabled: boolean
  onToggleAi: (enabled: boolean) => void
  /** The tone last applied to the whole document this session, echoed back to the user. */
  docStyle: TonePreset | null
  onToneRewrite: (tone: TonePreset) => void
  /** A free-form change applied across the whole document, e.g. "use British spelling". */
  onDocInstruction: (instruction: string) => void
  busy: boolean
  /** False when there is nothing to clear: an empty document with no pending proposals. */
  canClear: boolean
  onClear: () => void
}

/**
 * Document-level surface only. Block-level actions live in the block toolbar and are
 * deliberately not reachable from here, so a doc-wide rewrite can never be triggered
 * by reaching for a paragraph nudge.
 */
export function TopToolbar({
  aiEnabled,
  onToggleAi,
  docStyle,
  onToneRewrite,
  onDocInstruction,
  busy,
  canClear,
  onClear,
}: TopToolbarProps) {
  const [instruction, setInstruction] = useState('')
  const trimmed = instruction.trim()

  return (
    <header className="top-toolbar">
      <span className="brand">doccolaby</span>

      <div className="tone-group" aria-label="Rewrite the whole document">
        <span className="tone-label">Rewrite document as</span>
        {TONE_PRESETS.map((tone) => (
          <button
            key={tone}
            type="button"
            className={`tone-button${docStyle === tone ? ' is-active' : ''}`}
            disabled={!aiEnabled || busy}
            onClick={() => onToneRewrite(tone)}
          >
            {TONE_LABELS[tone]}
          </button>
        ))}
      </div>

      <form
        className="doc-instruction"
        aria-label="Change the whole document"
        onSubmit={(event) => {
          event.preventDefault()
          if (!trimmed || !aiEnabled || busy) return
          setInstruction('')
          onDocInstruction(trimmed)
        }}
      >
        <input
          type="text"
          value={instruction}
          placeholder="Change the whole document…"
          disabled={!aiEnabled}
          onChange={(event) => setInstruction(event.target.value)}
        />
        <button type="submit" disabled={!aiEnabled || busy || !trimmed}>
          Apply
        </button>
      </form>

      <button
        type="button"
        className="clear-button"
        disabled={!canClear || busy}
        title="Start over with a blank page (Ctrl+Z brings it back)"
        onClick={onClear}
      >
        Clear
      </button>

      <label className="ai-toggle">
        <input
          type="checkbox"
          checked={aiEnabled}
          onChange={(event) => onToggleAi(event.target.checked)}
        />
        <span>AI {aiEnabled ? 'on' : 'off'}</span>
      </label>
    </header>
  )
}
