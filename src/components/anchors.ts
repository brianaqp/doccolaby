import type { Editor } from '@tiptap/react'
import { findBlockRange } from '../editor/blocks'

export interface Anchor {
  top: number
  left: number
}

/**
 * Where a block sits inside the editor shell, so a floating surface can be pinned to it.
 * Returns null when the block is no longer in the document.
 */
export function anchorForBlock(
  editor: Editor,
  blockId: string,
  container: HTMLElement | null,
  placement: 'above' | 'below' = 'above',
): Anchor | null {
  if (!container) return null

  const range = findBlockRange(editor, blockId)
  if (!range) return null

  const dom = editor.view.nodeDOM(range.from)
  if (!(dom instanceof HTMLElement)) return null

  const block = dom.getBoundingClientRect()
  const shell = container.getBoundingClientRect()

  const left = block.left - shell.left
  if (placement === 'below') return { top: block.bottom - shell.top + 4, left }
  // Float just above the block's top edge.
  return { top: block.top - shell.top - 38, left }
}
