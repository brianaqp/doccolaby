/**
 * The document survives a reload as markdown in localStorage. Pending suggestions are
 * decorations, not content, so they are never persisted — a reload drops them.
 *
 * Every access is guarded: storage can be disabled, full, or throw in private windows, and the
 * editor must still open (blank) when it does.
 */
const DRAFT_KEY = 'doccolaby:draft'

export function loadDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? ''
  } catch {
    return ''
  }
}

/** An empty document removes the key rather than storing `''`, so "blank" has one representation. */
export function saveDraft(markdown: string): void {
  try {
    if (markdown.trim()) localStorage.setItem(DRAFT_KEY, markdown)
    else localStorage.removeItem(DRAFT_KEY)
  } catch {
    // Persistence is a convenience; losing it must not break editing.
  }
}
