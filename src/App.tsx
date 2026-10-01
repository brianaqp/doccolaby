import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'

import type { AiAction, RefineTurn, TonePreset } from '../shared/contract/aiAction'
import { structureToMarkdown } from '../shared/contract/structure'
import { requestAiAction, requestStructure } from './ai/client'
import { editorExtensions } from './editor/extensions'
import { blockEntries, getBlockIdAt, getBlockIdAtY, getBlockMarkdown, getDocumentMarkdown, listBlocks } from './editor/blocks'
import { loadDraft, saveDraft } from './editor/draftStorage'
import { getSuggestion, getSuggestions } from './editor/SuggestionDecorations'
import { acceptSuggestion, rejectSuggestion } from './editor/applySuggestion'
import { anchorForBlock } from './components/anchors'
import { BlockHandle } from './components/BlockHandle'
import { BlockToolbar } from './components/BlockToolbar'
import { DocReviewBar } from './components/DocReviewBar'
import { SuggestionCard } from './components/SuggestionCard'
import { TopToolbar } from './components/TopToolbar'

// Only needed on a blank page, so it stays out of the main bundle.
const StructurePrompt = lazy(() => import('./components/StructurePrompt'))

/** Typing settles for this long before the draft is written to localStorage. */
const SAVE_DELAY_MS = 400

/** What produced a block's pending suggestion, so a refine round can re-send the same intent. */
interface SuggestionOrigin {
  action: AiAction
  selectionText?: string
  history: RefineTurn[]
}

export function App() {
  // Held in state, not a ref: the floating surfaces are positioned from this element's box,
  // so mounting it has to trigger a render or the first measurement has nothing to measure.
  const [paper, setPaper] = useState<HTMLDivElement | null>(null)
  const origins = useRef(new Map<string, SuggestionOrigin>())
  // Blocks proposed by the latest whole-document rewrite. They are reviewed through one
  // accept/reject bar instead of a card each.
  const [docBatch, setDocBatch] = useState<ReadonlySet<string>>(new Set())

  const [aiEnabled, setAiEnabled] = useState(true)
  const [docStyle, setDocStyle] = useState<TonePreset | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The block under the pointer shows a pencil handle; clicking it opens that block's toolbar,
  // which then stays put until Escape or its close button — hovering elsewhere never hides it.
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const closeToolbar = useCallback(() => setOpenId(null), [])

  // Bumped whenever suggestions change, so the floating cards re-read editor storage and
  // re-measure against the updated document.
  const [, setRevision] = useState(0)
  const bump = useCallback(() => setRevision((n) => n + 1), [])

  // Lazy initializer: storage is read once on mount, not on every render.
  const [initialDraft] = useState(loadDraft)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const scheduleSave = useCallback((editor: Editor) => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveDraft(getDocumentMarkdown(editor)), SAVE_DELAY_MS)
  }, [])

  const editor = useEditor({
    extensions: editorExtensions,
    content: initialDraft,
    contentType: 'markdown',
    onSelectionUpdate: bump,
    onUpdate: ({ editor }) => {
      scheduleSave(editor)
      bump()
    },
  })

  // A reload or tab close inside the debounce window would otherwise lose the last keystrokes.
  useEffect(() => {
    if (!editor) return
    const flush = () => {
      clearTimeout(saveTimer.current)
      saveDraft(getDocumentMarkdown(editor))
    }
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      clearTimeout(saveTimer.current)
    }
  }, [editor])

  const run = useCallback(async <T,>(label: string, request: () => Promise<T>) => {
    setError(null)
    setBusy(label)
    try {
      return await request()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setBusy(null)
    }
  }, [])

  /** Block-scoped: one paragraph, never anything around it. */
  const runBlockAction = useCallback(
    async (blockId: string, action: AiAction, instruction?: string, selectionText?: string) => {
      if (!editor || !aiEnabled) return

      const history = origins.current.get(blockId)?.history ?? []

      const response = await run(action.replace('_', ' '), () =>
        requestAiAction({
          scope: 'block',
          action,
          blockId,
          blockText: getBlockMarkdown(editor, blockId),
          selectionText,
          instruction,
          fullDocumentContext: getDocumentMarkdown(editor),
          docStyleContext: docStyle,
          history: history.length ? history : undefined,
        }),
      )
      if (!response) return

      const target = response.targets.find((t) => t.blockId === blockId) ?? response.targets[0]
      if (!target || !editor.commands.setSuggestion(blockId, target.content)) {
        setError('The AI decided this paragraph was already fine.')
        return
      }

      origins.current.set(blockId, { action, selectionText, history })
      // The suggestion card takes over from here.
      setOpenId((current) => (current === blockId ? null : current))
      bump()
    },
    [editor, aiEnabled, docStyle, run, bump],
  )

  /**
   * Document-scoped tone rewrite. The response is fanned out into one independent per-block
   * suggestion, so the user still reviews the document paragraph by paragraph instead of
   * accepting one opaque replacement.
   */
  const runDocTone = useCallback(
    async (tone: TonePreset) => {
      if (!editor || !aiEnabled) return

      const blocks = listBlocks(editor)
      if (!blocks.length) return

      const response = await run(`rewrite the document as ${tone}`, () =>
        requestAiAction({
          scope: 'doc',
          action: 'set_tone',
          instruction: `Rewrite the document in a ${tone} tone.`,
          fullDocumentContext: getDocumentMarkdown(editor),
          docStyleContext: docStyle,
          blocks,
        }),
      )
      if (!response) return

      const known = new Set(blocks.map((block) => block.blockId))
      let applied = 0
      const batch = new Set<string>()
      for (const target of response.targets) {
        if (!known.has(target.blockId)) continue
        if (!editor.commands.setSuggestion(target.blockId, target.content)) continue
        origins.current.set(target.blockId, { action: 'set_tone', history: [] })
        batch.add(target.blockId)
        applied += 1
      }
      // A new rewrite supersedes any earlier one still waiting for review.
      setDocBatch(batch)

      // The tone is remembered even if nothing changed, so later block edits stay consistent.
      setDocStyle(tone)
      if (applied === 0) setError(`The AI thought the document already read as ${tone}.`)
      bump()
    },
    [editor, aiEnabled, docStyle, run, bump],
  )

  const accept = useCallback(
    (blockId: string) => {
      if (!editor) return
      acceptSuggestion(editor, blockId)
      origins.current.delete(blockId)
      bump()
    },
    [editor, bump],
  )

  const reject = useCallback(
    (blockId: string) => {
      if (!editor) return
      rejectSuggestion(editor, blockId)
      origins.current.delete(blockId)
      bump()
    },
    [editor, bump],
  )

  const resolveBatch = useCallback(
    (resolve: (editor: Editor, blockId: string) => boolean) => {
      if (!editor) return
      for (const blockId of docBatch) {
        if (!getSuggestion(editor, blockId)) continue
        resolve(editor, blockId)
        origins.current.delete(blockId)
      }
      setDocBatch(new Set())
      bump()
    },
    [editor, docBatch, bump],
  )

  /** Re-asks with the current proposal plus the new instruction — same block, multi-turn. */
  const refine = useCallback(
    async (blockId: string, instruction: string) => {
      if (!editor) return
      const current = getSuggestion(editor, blockId)
      const origin = origins.current.get(blockId)
      if (!current || !origin) return

      origins.current.set(blockId, {
        ...origin,
        history: [...origin.history, { proposal: current.proposal, instruction }],
      })
      await runBlockAction(blockId, origin.action, instruction, origin.selectionText)
    },
    [editor, runBlockAction],
  )

  /**
   * Blank-page outline. A blank document is a single empty paragraph, so the outline is proposed
   * as that paragraph's replacement: nothing lands in the document until it is accepted, and it
   * can be refined like any other suggestion.
   */
  const proposeStructure = useCallback(
    async (brief: string) => {
      if (!editor || !aiEnabled) return

      const response = await run('propose a structure', () => requestStructure({ brief }))
      if (!response) return

      const [blank] = blockEntries(editor)
      if (!editor.isEmpty || !blank) {
        setError('The page is no longer blank, so the outline was not proposed.')
        return
      }
      if (!editor.commands.setSuggestion(blank.blockId, structureToMarkdown(response.sections))) {
        setError('The AI did not propose an outline.')
        return
      }

      origins.current.set(blank.blockId, { action: 'rewrite', history: [] })
      bump()
    },
    [editor, aiEnabled, run, bump],
  )

  /**
   * Back to a blank page. The document is emptied in one transaction rather than rebuilt, so a
   * single undo brings it back; session state is replaced with fresh values, not patched.
   */
  const clearDocument = useCallback(() => {
    if (!editor) return
    editor.commands.clearAllSuggestions()
    origins.current = new Map()
    setDocBatch(new Set())
    setDocStyle(null)
    setError(null)
    setHoveredId(null)
    setOpenId(null)
    // Emits an update, which also clears the stored draft.
    editor.chain().focus().clearContent(true).run()
  }, [editor])

  const toggleAi = useCallback(
    (enabled: boolean) => {
      setAiEnabled(enabled)
      setError(null)
      if (!enabled && editor) {
        // With AI off this is a plain markdown editor — no stray proposals left behind.
        editor.commands.clearAllSuggestions()
        origins.current.clear()
        setDocBatch(new Set())
        setHoveredId(null)
        setOpenId(null)
        bump()
      }
    },
    [editor, bump],
  )

  const pending = editor ? [...getSuggestions(editor).keys()] : []
  const batchPending = pending.filter((id) => docBatch.has(id))
  const isBlank = editor?.isEmpty ?? true

  /** The text selected inside the toolbar's block, if the cursor happens to be in it. */
  let selectionText: string | undefined
  if (editor && openId) {
    const { from, to, empty } = editor.state.selection
    if (!empty && getBlockIdAt(editor, from) === openId) {
      selectionText = editor.state.doc.textBetween(from, to, ' ')
    }
  }

  // A block showing accept/reject controls offers neither the toolbar nor its handle.
  const toolbarBlockId = aiEnabled && openId && !pending.includes(openId) ? openId : null
  const toolbarAnchor =
    editor && toolbarBlockId ? anchorForBlock(editor, toolbarBlockId, paper, 'below') : null
  const handleBlockId =
    aiEnabled && hoveredId && hoveredId !== toolbarBlockId && !pending.includes(hoveredId) ? hoveredId : null
  const handleAnchor =
    editor && handleBlockId ? anchorForBlock(editor, handleBlockId, paper, 'gutter') : null

  return (
    <>
      <TopToolbar
        aiEnabled={aiEnabled}
        onToggleAi={toggleAi}
        docStyle={docStyle}
        onToneRewrite={runDocTone}
        busy={busy !== null}
        canClear={!isBlank || pending.length > 0}
        onClear={clearDocument}
      />

      {aiEnabled && batchPending.length > 0 && (
        <DocReviewBar
          count={batchPending.length}
          busy={busy !== null}
          onAcceptAll={() => resolveBatch(acceptSuggestion)}
          onRejectAll={() => resolveBatch(rejectSuggestion)}
        />
      )}

      <main className="shell">
        {aiEnabled && isBlank && pending.length === 0 && (
          <Suspense fallback={null}>
            <StructurePrompt busy={busy !== null} onPropose={(brief) => void proposeStructure(brief)} />
          </Suspense>
        )}

        <div
          className="paper"
          ref={setPaper}
          onMouseMove={(event) => {
            if (!editor || !aiEnabled) return
            // Between blocks the current one stays targeted, so the handle does not flicker.
            const id = getBlockIdAtY(editor, event.clientY)
            if (id) setHoveredId(id)
          }}
          onMouseLeave={() => setHoveredId(null)}
        >
          <EditorContent editor={editor} />

          {handleBlockId && handleAnchor && (
            <BlockHandle
              top={handleAnchor.top}
              left={handleAnchor.left}
              onOpen={() => setOpenId(handleBlockId)}
            />
          )}

          {toolbarBlockId && toolbarAnchor && (
            <BlockToolbar
              key={toolbarBlockId}
              top={toolbarAnchor.top}
              left={toolbarAnchor.left}
              hasSelection={selectionText !== undefined}
              busy={busy !== null}
              onAction={(action, instruction) =>
                void runBlockAction(toolbarBlockId, action, instruction, selectionText)
              }
              onDismiss={closeToolbar}
            />
          )}

          {editor &&
            pending.map((blockId) => {
              if (docBatch.has(blockId)) return null
              const anchor = anchorForBlock(editor, blockId, paper)
              if (!anchor) return null
              return (
                <SuggestionCard
                  key={blockId}
                  top={anchor.top}
                  left={anchor.left}
                  busy={busy !== null}
                  onAccept={() => accept(blockId)}
                  onReject={() => reject(blockId)}
                  onRefine={(instruction) => void refine(blockId, instruction)}
                />
              )
            })}
        </div>

        <p className="hint">
          {aiEnabled
            ? 'Hover a paragraph and click the pencil for AI actions — select text inside it first to narrow the edit. Esc closes the toolbar. Proposals appear inline — accept, reject, or refine each one. A whole-document rewrite is accepted or rejected in one go.'
            : 'AI is off. This is a plain markdown editor.'}
        </p>
      </main>

      {(busy || error) && (
        <div className={`status${error ? ' is-error' : ''}`}>
          <span>{error ?? `Asking the AI to ${busy}…`}</span>
          {error && (
            <button type="button" onClick={() => setError(null)}>
              Dismiss
            </button>
          )}
        </div>
      )}
    </>
  )
}
