import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'

export interface BlockRange {
  /** Position directly before the block node. */
  from: number
  /** Position directly after the block node. */
  to: number
  node: PMNode
}

export interface BlockEntry extends BlockRange {
  blockId: string
}

/**
 * Every addressable block, in document order. Only the document's direct children count:
 * UniqueID also tags nested paragraphs inside lists and blockquotes, but addressing those
 * separately would let the AI rewrite half a list while the enclosing block is also under
 * review.
 */
export function blockEntries(editor: Editor): BlockEntry[] {
  const entries: BlockEntry[] = []
  const { doc } = editor.state

  for (let i = 0, from = 0; i < doc.childCount; i += 1) {
    const node = doc.child(i)
    const blockId = node.attrs.id
    if (typeof blockId === 'string' && blockId.length > 0) {
      entries.push({ blockId, node, from, to: from + node.nodeSize })
    }
    from += node.nodeSize
  }

  return entries
}

export function findBlockRange(editor: Editor, blockId: string): BlockRange | null {
  for (const entry of blockEntries(editor)) {
    if (entry.blockId === blockId) return { from: entry.from, to: entry.to, node: entry.node }
  }
  return null
}

/** Markdown source of a single node, produced by the editor's own markdown serializer. */
export function serializeBlock(editor: Editor, node: PMNode): string {
  const manager = editor.storage.markdown?.manager
  if (!manager) return node.textContent
  return manager.serialize({ type: 'doc', content: [node.toJSON()] }).trim()
}

/** The markdown source of one block, or `''` when that block is no longer in the document. */
export function getBlockMarkdown(editor: Editor, blockId: string): string {
  const range = findBlockRange(editor, blockId)
  return range ? serializeBlock(editor, range.node) : ''
}

/** Markdown for the whole document, block by block. Empty blocks are skipped. */
export function listBlocks(editor: Editor): Array<{ blockId: string; text: string }> {
  const blocks: Array<{ blockId: string; text: string }> = []

  for (const entry of blockEntries(editor)) {
    if (entry.node.textContent.trim().length === 0) continue
    const text = serializeBlock(editor, entry.node)
    if (text.length > 0) blocks.push({ blockId: entry.blockId, text })
  }

  return blocks
}

/** The id of the top-level block containing `pos`, for selection targeting. */
export function getBlockIdAt(editor: Editor, pos: number): string | null {
  const { doc } = editor.state
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)))
  const node = $pos.depth > 0 ? $pos.node(1) : doc.maybeChild($pos.index(0))
  const blockId = node?.attrs.id
  return typeof blockId === 'string' && blockId.length > 0 ? blockId : null
}

/**
 * Ids of every top-level block a non-empty selection touches, in document order. A collapsed
 * cursor selects nothing, so it returns an empty list.
 */
export function getSelectedBlockIds(state: EditorState): string[] {
  const { doc, selection } = state
  if (selection.empty) return []

  const ids: string[] = []
  doc.forEach((node, offset) => {
    const blockId = node.attrs.id
    if (typeof blockId !== 'string' || blockId.length === 0) return
    // Compared against the block's content, strictly: a selection that only reaches a block's
    // edge (a triple-click ends at the next block's start) has not selected anything in it.
    const contentFrom = offset + 1
    const contentTo = offset + node.nodeSize - 1
    if (selection.from < contentTo && selection.to > contentFrom) ids.push(blockId)
  })
  return ids
}

/**
 * The id of the top-level block spanning the viewport y coordinate `clientY`. Matching on the
 * vertical band alone (not the exact point) keeps the block targeted while the pointer is in
 * the page gutter beside it.
 */
export function getBlockIdAtY(editor: Editor, clientY: number): string | null {
  for (const entry of blockEntries(editor)) {
    const dom = editor.view.nodeDOM(entry.from)
    if (!(dom instanceof HTMLElement)) continue
    const { top, bottom } = dom.getBoundingClientRect()
    if (clientY >= top && clientY <= bottom) return entry.blockId
  }
  return null
}

export function getDocumentMarkdown(editor: Editor): string {
  return editor.getMarkdown()
}
