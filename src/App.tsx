import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'

import type { AiAction, AiActionRequest, RefineTurn, TonePreset } from '../shared/contract'
import { requestAiAction } from './ai/client'
import { editorExtensions, STARTER_DOC } from './editor/extensions'
import { getBlockIdAt, getBlockMarkdown, getDocumentMarkdown, listBlocks } from './editor/blocks'
import { getSuggestion, getSuggestions } from './editor/SuggestionDecorations'
import { acceptSuggestion, rejectSuggestion } from './editor/applySuggestion'
import { anchorForBlock } from './components/anchors'
import { BlockToolbar } from './components/BlockToolbar'
import { DocReviewBar } from './components/DocReviewBar'
import { SuggestionCard } from './components/SuggestionCard'
import { TopToolbar } from './components/TopToolbar'

/** How long the toolbar lingers after the pointer leaves both the block and the toolbar. */
const HOVER_HIDE_DELAY_MS = 200

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
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const cancelHide = useCallback(() => clearTimeout(hideTimer.current), [])
  /** Drop the hover target after a grace period, so the pointer can travel block -> toolbar. */
  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setHoveredId(null), HOVER_HIDE_DELAY_MS)
  }, [])
  /** Hide right now, skipping the grace period. */
  const hideNow = useCallback(() => {
    clearTimeout(hideTimer.current)
    setHoveredId(null)
  }, [])
  useEffect(() => () => clearTimeout(hideTimer.current), [])

  // Bumped whenever suggestions change, so the floating cards re-read editor storage and
  // re-measure against the updated document.
  const [, setRevision] = useState(0)
  const bump = useCallback(() => setRevision((n) => n + 1), [])

  const editor = useEditor({
    extensions: editorExtensions,
    content: STARTER_DOC,
    contentType: 'markdown',
    onSelectionUpdate: bump,
    onUpdate: bump,
  })

  const run = useCallback(async (label: string, body: AiActionRequest) => {
    setError(null)
    setBusy(label)
    try {
      return await requestAiAction(body)
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

      const response = await run(action.replace('_', ' '), {
        scope: 'block',
        action,
        blockId,
        blockText: getBlockMarkdown(editor, blockId),
        selectionText,
        instruction,
        fullDocumentContext: getDocumentMarkdown(editor),
        docStyleContext: docStyle,
        history: history.length ? history : undefined,
      })
      if (!response) return

      const target = response.targets.find((t) => t.blockId === blockId) ?? response.targets[0]
      if (!target || !editor.commands.setSuggestion(blockId, target.content)) {
        setError('The AI decided this paragraph was already fine.')
        return
      }

      origins.current.set(blockId, { action, selectionText, history })
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

      const response = await run(`rewrite the document as ${tone}`, {
        scope: 'doc',
        action: 'set_tone',
        instruction: `Rewrite the document in a ${tone} tone.`,
        fullDocumentContext: getDocumentMarkdown(editor),
        docStyleContext: docStyle,
        blocks,
      })
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

  const toggleAi = useCallback(
    (enabled: boolean) => {
      setAiEnabled(enabled)
      setError(null)
      if (!enabled && editor) {
        // With AI off this is a plain markdown editor — no stray proposals left behind.
        editor.commands.clearAllSuggestions()
        origins.current.clear()
        setDocBatch(new Set())
        hideNow()
        bump()
      }
    },
    [editor, bump, hideNow],
  )

  const pending = editor ? [...getSuggestions(editor).keys()] : []
  const batchPending = pending.filter((id) => docBatch.has(id))

  /** The text selected inside the hovered block, if the cursor happens to be in it. */
  let selectionText: string | undefined
  if (editor && hoveredId) {
    const { from, to, empty } = editor.state.selection
    if (!empty && getBlockIdAt(editor, from) === hoveredId) {
      selectionText = editor.state.doc.textBetween(from, to, ' ')
    }
  }

  // A block showing accept/reject controls does not also show the hover toolbar.
  const toolbarBlockId = aiEnabled && hoveredId && !pending.includes(hoveredId) ? hoveredId : null
  const toolbarAnchor =
    editor && toolbarBlockId ? anchorForBlock(editor, toolbarBlockId, paper, 'below') : null

  return (
    <>
      <TopToolbar
        aiEnabled={aiEnabled}
        onToggleAi={toggleAi}
        docStyle={docStyle}
        onToneRewrite={runDocTone}
        busy={busy !== null}
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
        <div
          className="paper"
          ref={setPaper}
          onMouseMove={(event) => {
            if (!editor || !aiEnabled) return
            const at = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })
            const id = at ? getBlockIdAt(editor, at.pos) : null
            if (id) {
              // Show immediately, and keep it alive while the pointer stays on the block.
              cancelHide()
              setHoveredId(id)
            } else {
              scheduleHide()
            }
          }}
          onMouseLeave={scheduleHide}
        >
          <EditorContent editor={editor} />

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
              onPointerEnter={cancelHide}
              onPointerLeave={scheduleHide}
              onDismiss={hideNow}
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
            ? 'Hover a paragraph for AI actions, or select text inside it first to narrow the edit. Proposals appear inline — accept, reject, or refine each one. A whole-document rewrite is accepted or rejected in one go.'
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
