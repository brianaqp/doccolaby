import type { Editor } from '@tiptap/core'

import { findBlockRange } from './blocks'
import { getSuggestion } from './SuggestionDecorations'

/**
 * Replaces a block with its pending proposal and clears the decoration, in one transaction so
 * a single undo puts the original block back. An empty proposal removes the block outright —
 * that is how the `delete_section` action arrives.
 */
export function acceptSuggestion(editor: Editor, blockId: string): boolean {
  const pending = getSuggestion(editor, blockId)
  if (!pending) return false

  const range = findBlockRange(editor, blockId)
  if (!range) return editor.commands.clearSuggestion(blockId)

  const proposal = pending.proposal.trim()
  const target = { from: range.from, to: range.to }
  const chain = editor.chain().focus()

  // The replacement block gets a fresh UniqueID, which is why the suggestion is cleared by the
  // id it was stored under rather than by whatever id ends up on the new node.
  if (proposal.length === 0) chain.deleteRange(target)
  else chain.insertContentAt(target, proposal, { contentType: 'markdown', updateSelection: false })

  return chain.clearSuggestion(blockId).run()
}

/** Drops the proposal and leaves the document exactly as it was. */
export function rejectSuggestion(editor: Editor, blockId: string): boolean {
  return editor.commands.clearSuggestion(blockId)
}
