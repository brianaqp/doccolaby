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
  busy: boolean
  /** False when there is nothing to clear: an empty document with no pending proposals. */
  canClear: boolean
  onClear: () => void
}

/**
 * Document-level surface only. Block-level actions live in the hover toolbar and are
 * deliberately not reachable from here, so a doc-wide rewrite can never be triggered
 * by reaching for a paragraph nudge.
 */
export function TopToolbar({
  aiEnabled,
  onToggleAi,
  docStyle,
  onToneRewrite,
  busy,
  canClear,
  onClear,
}: TopToolbarProps) {
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
