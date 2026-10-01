import { useState } from 'react'

export interface StructurePromptProps {
  busy: boolean
  onPropose: (brief: string) => void
}

/**
 * Blank-page starter. Only shown while the document is empty, so it is loaded lazily and never
 * costs anything once the user is writing. The outline it asks for arrives as an ordinary
 * suggestion, reviewed with the same accept / reject / refine card as any other edit.
 */
export default function StructurePrompt({ busy, onPropose }: StructurePromptProps) {
  const [brief, setBrief] = useState('')
  const trimmed = brief.trim()

  return (
    <form
      className="structure-prompt"
      onSubmit={(event) => {
        event.preventDefault()
        if (trimmed && !busy) onPropose(trimmed)
      }}
    >
      <label htmlFor="structure-brief">Blank page? Describe what you are writing and get a proposed outline.</label>
      <div className="structure-row">
        <input
          id="structure-brief"
          type="text"
          value={brief}
          placeholder="e.g. A post-mortem for last week's checkout outage"
          onChange={(event) => setBrief(event.target.value)}
        />
        <button type="submit" disabled={busy || !trimmed}>
          Propose structure
        </button>
      </div>
    </form>
  )
}
