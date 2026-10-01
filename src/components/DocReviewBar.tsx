export interface DocReviewBarProps {
  count: number
  busy: boolean
  onAcceptAll: () => void
  onRejectAll: () => void
}

/**
 * The single approve / reject decision for a whole-document rewrite. The per-paragraph diffs
 * stay visible inline, but they are resolved together rather than one card at a time.
 */
export function DocReviewBar({ count, busy, onAcceptAll, onRejectAll }: DocReviewBarProps) {
  return (
    <div className="doc-review-bar" role="region" aria-label="Review document rewrite">
      <span>
        Document rewrite: {count} {count === 1 ? 'paragraph' : 'paragraphs'} changed
      </span>
      <button type="button" className="accept" disabled={busy} onClick={onAcceptAll}>
        Accept all
      </button>
      <button type="button" className="reject" disabled={busy} onClick={onRejectAll}>
        Reject all
      </button>
    </div>
  )
}
