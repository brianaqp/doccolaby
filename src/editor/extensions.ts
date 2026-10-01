import { Markdown } from '@tiptap/markdown'
import { UniqueID } from '@tiptap/extension-unique-id'
import { StarterKit } from '@tiptap/starter-kit'

import { SelectedBlocks } from './SelectedBlocks'
import { SuggestionDecorations } from './SuggestionDecorations'

/** The node types the AI can address. Every one of them carries a stable `id` attribute. */
export const BLOCK_TYPES = [
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'blockquote',
  'codeBlock',
]

export const editorExtensions = [
  StarterKit,
  Markdown,
  UniqueID.configure({ types: BLOCK_TYPES }),
  SuggestionDecorations,
  SelectedBlocks,
]
