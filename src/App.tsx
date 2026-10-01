import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'

import type { AiAction, RefineTurn, TonePreset } from '../shared/contract/aiAction'
import { structureToMarkdown } from '../shared/contract/structure'
import { requestAiAction, requestStructure } from './ai/client'
import { editorExtensions } from './editor/extensions'
import { blockEntries, getBlockIdAtY, getBlockMarkdown, getDocumentMarkdown, getSelectedBlockIds, listBlocks } from './editor/blocks'
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

/** What an open toolbar acts on, captured when it opens. */
interface ToolbarTarget {
  /** One block (a single paragraph edit) or several (sent together as a selection). */
  blockIds: string[]
  /** Text selected inside the single target block, which narrows the edit to that span. */
  selectionText?: string
}

function sameBlocks(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
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
  // The selected blocks — or, with nothing selected, the block under the pointer — show a pencil
  // handle; clicking it opens a toolbar for those blocks, which then stays put until Escape or its
  // close button — hovering or selecting elsewhere never hides it.
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [openTarget, setOpenTarget] = useState<ToolbarTarget | null>(null)
  const closeToolbar = useCallback(() => setOpenTarget(null), [])

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

  // While the toolbar is open, its blocks stay highlighted even after focus moves to its input.
  useEffect(() => {
    editor?.commands.pinSelectedBlocks(openTarget?.blockIds ?? [])
  }, [editor, openTarget])

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
      setOpenTarget((current) => (current?.blockIds.includes(blockId) ? null : current))
      bump()
    },
    [editor, aiEnabled, docStyle, run, bump],
  )

  /**
   * Selection-scoped: every selected block is sent in one request, so the model can edit them as
   * one passage. Each returned block still gets its own suggestion, reviewed independently.
   */
  const runSelectionAction = useCallback(
    async (blockIds: string[], action: AiAction, instruction?: string) => {
      if (!editor || !aiEnabled) return

      const blocks = blockIds
        .map((blockId) => ({ blockId, text: getBlockMarkdown(editor, blockId) }))
        .filter((block) => block.text.length > 0)
      if (!blocks.length) return

      const response = await run(`${action.replace('_', ' ')} the selection`, () =>
        requestAiAction({
          scope: 'selection',
          action,
          instruction,
          fullDocumentContext: getDocumentMarkdown(editor),
          docStyleContext: docStyle,
          blocks,
        }),
      )
      if (!response) return

      const targeted = new Set(blocks.map((block) => block.blockId))
      let applied = 0
      for (const target of response.targets) {
        if (!targeted.has(target.blockId)) continue
        if (!editor.commands.setSuggestion(target.blockId, target.content)) continue
        origins.current.set(target.blockId, { action, history: [] })
        applied += 1
      }
      if (applied === 0) {
        setError('The AI decided the selection was already fine.')
        return
      }

      // The suggestion cards take over from here.
      setOpenTarget(null)
      bump()
    },
    [editor, aiEnabled, docStyle, run, bump],
  )

  /**
   * Document-scoped rewrite. The response is fanned out into one independent per-block
   * suggestion, so the user still reviews the document paragraph by paragraph instead of
   * accepting one opaque replacement. `tone` is set by the tone presets and remembered as the
   * document's style; a free-form instruction leaves the established style alone.
   */
  const runDocAction = useCallback(
    async (label: string, action: AiAction, instruction: string, tone?: TonePreset) => {
      if (!editor || !aiEnabled) return

      const blocks = listBlocks(editor)
      if (!blocks.length) return

      const response = await run(label, () =>
        requestAiAction({
          scope: 'doc',
          action,
          instruction,
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
        origins.current.set(target.blockId, { action, history: [] })
        batch.add(target.blockId)
        applied += 1
      }
      // A new rewrite supersedes any earlier one still waiting for review.
      setDocBatch(batch)

      // The tone is remembered even if nothing changed, so later block edits stay consistent.
      if (tone) setDocStyle(tone)
      if (applied === 0) {
        setError(tone ? `The AI thought the document already read as ${tone}.` : 'The AI found nothing to change.')
      }
      bump()
    },
    [editor, aiEnabled, docStyle, run, bump],
  )

  const runDocTone = useCallback(
    (tone: TonePreset) =>
      runDocAction(`rewrite the document as ${tone}`, 'set_tone', `Rewrite the document in a ${tone} tone.`, tone),
    [runDocAction],
  )

  const runDocInstruction = useCallback(
    (instruction: string) => runDocAction('change the document', 'rewrite', instruction),
    [runDocAction],
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
    setOpenTarget(null)
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
        setOpenTarget(null)
        bump()
      }
    },
    [editor, bump],
  )

  const pending = editor ? [...getSuggestions(editor).keys()] : []
  const batchPending = pending.filter((id) => docBatch.has(id))
  const isBlank = editor?.isEmpty ?? true

  // A block showing accept/reject controls is never targeted by the toolbar or its handle.
  const targetable = (id: string) => !pending.includes(id)
  const selectedIds = editor && aiEnabled ? getSelectedBlockIds(editor.state).filter(targetable) : []

  const toolbarIds = aiEnabled && openTarget ? openTarget.blockIds.filter(targetable) : []
  // Below the last target block, so it never covers the text being edited.
  const toolbarAnchor =
    editor && toolbarIds.length > 0 ? anchorForBlock(editor, toolbarIds[toolbarIds.length - 1], paper, 'below') : null

  // A selection claims the pencil wherever the pointer is; otherwise it follows the hover.
  const hoverIds = aiEnabled && hoveredId && targetable(hoveredId) ? [hoveredId] : []
  const candidateIds = selectedIds.length > 0 ? selectedIds : hoverIds
  const handleIds = sameBlocks(candidateIds, toolbarIds) ? [] : candidateIds
  const handleAnchor = editor && handleIds.length > 0 ? anchorForBlock(editor, handleIds[0], paper, 'gutter') : null

  const openToolbar = () => {
    if (!editor) return
    const { from, to } = editor.state.selection
    setOpenTarget({
      blockIds: handleIds,
      // A span inside one block narrows the edit; a multi-block selection sends whole blocks.
      selectionText: selectedIds.length === 1 ? editor.state.doc.textBetween(from, to, ' ') : undefined,
    })
  }

  return (
    <>
      <TopToolbar
        aiEnabled={aiEnabled}
        onToggleAi={toggleAi}
        docStyle={docStyle}
        onToneRewrite={runDocTone}
        onDocInstruction={runDocInstruction}
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
          className={`paper${aiEnabled ? ' ai-on' : ''}`}
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

          {handleAnchor && (
            <BlockHandle
              top={handleAnchor.top}
              left={handleAnchor.left}
              blockCount={handleIds.length}
              onOpen={openToolbar}
            />
          )}

          {openTarget && toolbarAnchor && (
            <BlockToolbar
              key={toolbarIds.join(' ')}
              top={toolbarAnchor.top}
              left={toolbarAnchor.left}
              blockCount={toolbarIds.length}
              busy={busy !== null}
              onAction={(action, instruction) =>
                void (toolbarIds.length === 1
                  ? runBlockAction(toolbarIds[0], action, instruction, openTarget.selectionText)
                  : runSelectionAction(toolbarIds, action, instruction))
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
            ? 'Hover a paragraph and click the pencil for AI actions. Select text to target it instead: inside one paragraph it narrows the edit, across several it sends every highlighted block together. Esc closes the toolbar. Proposals appear inline — accept, reject, or refine each one. Ask for document-wide changes from the top bar; a whole-document rewrite is accepted or rejected in one go.'
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
