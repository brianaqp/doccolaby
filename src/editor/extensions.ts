import { Markdown } from '@tiptap/markdown'
import { UniqueID } from '@tiptap/extension-unique-id'
import { StarterKit } from '@tiptap/starter-kit'

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
]

/**
 * Deliberately mediocre starter draft: vague, hedged and repetitive, so the AI actions have
 * something obvious to improve on first load.
 */
export const STARTER_DOC = `# Q3 Product Update

We shipped a bunch of things this quarter and it went pretty well overall. The new onboarding flow is live and the numbers seem to be moving in the right direction, which is good news.

There were some problems too. The data migration took a lot longer than we thought it would, mostly because of things we did not plan for.

Highlights:

- New onboarding flow
- Search is faster now
- Various bug fixes

> We still need to decide whether the pricing page rewrite lands this quarter or slips to Q4.

Next quarter we want to focus on making the product feel faster and on fixing the things people keep complaining about.
`
