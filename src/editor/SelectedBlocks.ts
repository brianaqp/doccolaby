import { Decoration, Extension } from '@tiptap/core'

import { getSelectedBlockIds } from './blocks'
import { getSuggestions } from './SuggestionDecorations'

export interface SelectedBlocksStorage {
  /**
   * Blocks an open toolbar is acting on. While set, they are highlighted instead of the live
   * selection, so the highlight keeps showing what will be sent after focus leaves the editor.
   */
  pinned: string[]
}

declare module '@tiptap/core' {
  interface Storage {
    selectedBlocks: SelectedBlocksStorage
  }

  interface Commands<ReturnType> {
    selectedBlocks: {
      /** Highlight exactly these blocks until called again with an empty list. */
      pinSelectedBlocks: (blockIds: string[]) => ReturnType
    }
  }
}

const EXTENSION_NAME = 'selectedBlocks'

/**
 * Highlights every top-level block the selection touches — the exact set an AI action will be
 * sent. Blocks under review are skipped: they are not targetable until accepted or rejected.
 */
export const SelectedBlocks = Extension.create({
  name: EXTENSION_NAME,

  addStorage(): SelectedBlocksStorage {
    return { pinned: [] }
  },

  addDecorations() {
    return {
      shouldUpdate: ({ tr, oldState, newState }) => tr.docChanged || !oldState.selection.eq(newState.selection),
      create: ({ editor, state }) => {
        const { pinned } = editor.storage.selectedBlocks
        const ids = new Set(pinned.length > 0 ? pinned : getSelectedBlockIds(state))
        if (ids.size === 0) return []

        const pending = getSuggestions(editor)
        const decorations: Decoration[] = []
        state.doc.forEach((node, offset) => {
          const blockId = node.attrs.id
          if (ids.has(blockId) && !pending.has(blockId)) {
            decorations.push(Decoration.Node(offset, offset + node.nodeSize, { class: 'selected-block' }))
          }
        })
        return decorations
      },
    }
  },

  addCommands() {
    return {
      pinSelectedBlocks:
        (blockIds: string[]) =>
        ({ editor, commands }) => {
          editor.storage.selectedBlocks.pinned = blockIds
          return commands.updateDecorations(EXTENSION_NAME)
        },
    }
  },
})
