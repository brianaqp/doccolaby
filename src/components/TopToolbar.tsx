import { TONE_PRESETS } from '../../shared/contract'
import type { TonePreset } from '../../shared/contract'

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
