import { Decoration, Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'

import { computeDiff, hasChanges } from './diff'
import type { DiffSegment } from './diff'
import { findBlockRange, serializeBlock } from './blocks'

export interface PendingSuggestion {
  /** The full markdown the AI proposes for this block. `''` means "delete the block". */
  proposal: string
  /** The block's markdown at the moment the proposal arrived — what `segments` diffed against. */
  source: string
  segments: DiffSegment[]
}

export type SuggestionMap = Map<string, PendingSuggestion>

export interface SuggestionDecorationsStorage {
  suggestions: SuggestionMap
}

declare module '@tiptap/core' {
  interface Storage {
    suggestionDecorations: SuggestionDecorationsStorage
  }

  interface Commands<ReturnType> {
    suggestionDecorations: {
      /** Diff `proposal` against the block's current markdown and show it inline. */
      setSuggestion: (blockId: string, proposal: string) => ReturnType
      /** Drop one block's pending suggestion. The document is not touched. */
      clearSuggestion: (blockId: string) => ReturnType
      /** Drop every pending suggestion. */
      clearAllSuggestions: () => ReturnType
    }
  }
}

const EXTENSION_NAME = 'suggestionDecorations'

interface TextRun {
  /** Offset of this run's first character within the block's concatenated text. */
  textStart: number
  /** Document position of this run's first character. */
  from: number
  length: number
}

function collectTextRuns(node: PMNode, blockFrom: number): { runs: TextRun[]; text: string } {
  const runs: TextRun[] = []
  let text = ''

  node.descendants((child, pos) => {
    if (!child.isText || !child.text) return true
    runs.push({ textStart: text.length, from: blockFrom + 1 + pos, length: child.text.length })
    text += child.text
    return false
  })

  return { runs, text }
}

/**
 * Maps every offset in a block's markdown onto an offset in its rendered text.
 *
 * The diff runs over markdown (that is what the model reads and writes), but decorations have
 * to land on text positions. The text is a subsequence of the markdown — the difference is
 * syntax characters like `#`, `**` or `- ` — so a single forward scan is enough: a character
 * that matches consumes one text offset, a syntax character consumes none. Returns null when
 * the scan fails to consume the whole text, which means the alignment cannot be trusted.
 */
function alignMarkdownToText(markdown: string, text: string): number[] | null {
  const offsets = new Array<number>(markdown.length + 1)
  let consumed = 0

  for (let i = 0; i < markdown.length; i += 1) {
    offsets[i] = consumed
    if (consumed < text.length && markdown[i] === text[consumed]) consumed += 1
  }
  offsets[markdown.length] = consumed

  return consumed === text.length ? offsets : null
}

function posForTextOffset(runs: TextRun[], offset: number): number {
  for (const run of runs) {
    if (offset <= run.textStart + run.length) return run.from + Math.max(0, offset - run.textStart)
  }
  const last = runs[runs.length - 1]
  return last.from + last.length
}

function insertionWidget(blockId: string, index: number, pos: number, value: string): Decoration {
  return Decoration.Widget(
    pos,
    () => {
      const span = document.createElement('span')
      span.className = 'suggestion-insert'
      span.textContent = value
      return span
    },
    // The value is part of the key so a refined proposal remounts the widget instead of
    // keeping the previous text, which ProseMirror fixes on first mount.
    { key: `${EXTENSION_NAME}:${blockId}:${index}:${value}`, side: 1 },
  )
}

function decorateBlock(entry: { node: PMNode; from: number; blockId: string }, pending: PendingSuggestion): Decoration[] {
  const { node, from, blockId } = entry
  const to = from + node.nodeSize
  const decorations: Decoration[] = [Decoration.Node(from, to, { class: 'suggestion-block' })]

  const contentFrom = from + 1
  const contentTo = to - 1
  const clamp = (pos: number) => Math.max(contentFrom, Math.min(pos, contentTo))

  const { runs, text } = collectTextRuns(node, from)
  const offsets = runs.length > 0 ? alignMarkdownToText(pending.source, text) : null

  if (!offsets) {
    // Degraded but never broken: show the whole proposal at the end of the block.
    decorations.push(insertionWidget(blockId, 0, contentTo, pending.proposal))
    return decorations
  }

  const lastOffset = offsets.length - 1
  let cursor = 0
  let widgets = 0

  for (const segment of pending.segments) {
    const start = offsets[Math.min(cursor, lastOffset)]

    if (segment.type === 'insert') {
      if (segment.value.length > 0) {
        decorations.push(insertionWidget(blockId, widgets, clamp(posForTextOffset(runs, start)), segment.value))
        widgets += 1
      }
      continue
    }

    cursor += segment.value.length
    if (segment.type === 'equal') continue

    const end = offsets[Math.min(cursor, lastOffset)]
    const deleteFrom = clamp(posForTextOffset(runs, start))
    const deleteTo = clamp(posForTextOffset(runs, end))
    if (deleteTo > deleteFrom) {
      decorations.push(Decoration.Inline(deleteFrom, deleteTo, { class: 'suggestion-delete' }))
    }
  }

  return decorations
}

/**
 * Renders pending AI proposals as inline tracked changes, scoped per block. Several blocks can
 * hold independent suggestions at once — a whole-document tone rewrite produces one per
 * paragraph, each accepted or rejected on its own.
 */
export const SuggestionDecorations = Extension.create({
  name: EXTENSION_NAME,

  addStorage(): SuggestionDecorationsStorage {
    return { suggestions: new Map() }
  },

  addDecorations() {
    return {
      update: 'manual',
      create: ({ editor, state }) => {
        const { suggestions } = editor.storage.suggestionDecorations
        if (suggestions.size === 0) return []

        const decorations: Decoration[] = []
        let from = 0

        for (let i = 0; i < state.doc.childCount; i += 1) {
          const node = state.doc.child(i)
          const blockId = node.attrs.id
          const pending = typeof blockId === 'string' ? suggestions.get(blockId) : undefined
          if (pending) decorations.push(...decorateBlock({ node, from, blockId }, pending))
          from += node.nodeSize
        }

        return decorations
      },
    }
  },

  addCommands() {
    return {
      setSuggestion:
        (blockId: string, proposal: string) =>
        ({ editor, commands }) => {
          const range = findBlockRange(editor, blockId)
          if (!range) return false

          const source = serializeBlock(editor, range.node)
          const segments = computeDiff(source, proposal)

          // A proposal identical to what is already there would render an empty diff.
          if (!hasChanges(segments)) return false

          editor.storage.suggestionDecorations.suggestions.set(blockId, { proposal, source, segments })
          return commands.updateDecorations(EXTENSION_NAME)
        },

      clearSuggestion:
        (blockId: string) =>
        ({ editor, commands }) => {
          if (!editor.storage.suggestionDecorations.suggestions.delete(blockId)) return false
          return commands.updateDecorations(EXTENSION_NAME)
        },

      clearAllSuggestions:
        () =>
        ({ editor, commands }) => {
          const { suggestions } = editor.storage.suggestionDecorations
          if (suggestions.size === 0) return false
          suggestions.clear()
          return commands.updateDecorations(EXTENSION_NAME)
        },
    }
  },
})

/** Every pending suggestion, keyed by block id, so React can render one control per block. */
export function getSuggestions(editor: Editor): SuggestionMap {
  return editor.storage.suggestionDecorations?.suggestions ?? new Map()
}

export function getSuggestion(editor: Editor, blockId: string): PendingSuggestion | null {
  return getSuggestions(editor).get(blockId) ?? null
}
