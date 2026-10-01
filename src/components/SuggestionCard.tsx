import { useState } from 'react'

export interface SuggestionCardProps {
  top: number
  left: number
  busy: boolean
  onAccept: () => void
  onReject: () => void
  onRefine: (instruction: string) => void
}

/**
 * Accept / reject / refine controls for one pending suggestion. One card per affected
 * block — a whole-document rewrite produces several, each resolved independently.
 */
export function SuggestionCard({
  top,
  left,
  busy,
  onAccept,
  onReject,
  onRefine,
}: SuggestionCardProps) {
  const [refining, setRefining] = useState(false)
  const [instruction, setInstruction] = useState('')

  function submitRefine() {
    const trimmed = instruction.trim()
    if (!trimmed) return
    setInstruction('')
    setRefining(false)
    onRefine(trimmed)
  }

  return (
    <div className="suggestion-card" style={{ top, left }}>
      {refining ? (
        <input
          autoFocus
          className="instruction-input"
          placeholder="What should be different?"
          value={instruction}
          disabled={busy}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submitRefine()
            } else if (event.key === 'Escape') {
              setRefining(false)
            }
          }}
        />
      ) : (
        <>
          <button type="button" className="accept" disabled={busy} onClick={onAccept}>
            Accept
          </button>
          <button type="button" className="reject" disabled={busy} onClick={onReject}>
            Reject
          </button>
          <button type="button" disabled={busy} onClick={() => setRefining(true)}>
            Refine
          </button>
        </>
      )}
    </div>
  )
}
