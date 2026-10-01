import { diffWordsWithSpace } from 'diff'

/**
 * One run of the word-level diff between a block's current markdown and the AI's proposal.
 * `delete` segments exist only in the current text, `insert` segments only in the proposal.
 */
export interface DiffSegment {
  type: 'equal' | 'insert' | 'delete'
  value: string
}

/** Word-level diff, whitespace preserved so the rendered diff keeps the original spacing. */
export function computeDiff(before: string, after: string): DiffSegment[] {
  return diffWordsWithSpace(before, after).map((change): DiffSegment => {
    if (change.added) return { type: 'insert', value: change.value }
    if (change.removed) return { type: 'delete', value: change.value }
    return { type: 'equal', value: change.value }
  })
}

/** False when the model handed back what was already there — a suggestion not worth showing. */
export function hasChanges(segments: DiffSegment[]): boolean {
  return segments.some((segment) => segment.type !== 'equal' && segment.value.length > 0)
}
