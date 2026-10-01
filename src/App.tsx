import { useCallback, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'

import type { AiAction, AiActionRequest, RefineTurn, TonePreset } from '../shared/contract'
import { requestAiAction } from './ai/client'
import { editorExtensions, STARTER_DOC } from './editor/extensions'
import { getBlockIdAt, getBlockMarkdown, getDocumentMarkdown, listBlocks } from './editor/blocks'
import { getSuggestion, getSuggestions } from './editor/SuggestionDecorations'
import { acceptSuggestion, rejectSuggestion } from './editor/applySuggestion'
import { anchorForBlock } from './components/anchors'
import { BlockToolbar } from './components/BlockToolbar'
import { SuggestionCard } from './components/SuggestionCard'
import { TopToolbar } from './components/TopToolbar'

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

  const [aiEnabled, setAiEnabled] = useState(true)
  const [docStyle, setDocStyle] = useState<TonePreset | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

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
      for (const target of response.targets) {
        if (!known.has(target.blockId)) continue
        if (!editor.commands.setSuggestion(target.blockId, target.content)) continue
        origins.current.set(target.blockId, { action: 'set_tone', history: [] })
        applied += 1
      }

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
        setHoveredId(null)
        bump()
      }
    },
    [editor, bump],
  )

  const pending = editor ? [...getSuggestions(editor).keys()] : []

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
    editor && toolbarBlockId ? anchorForBlock(editor, toolbarBlockId, paper) : null

  return (
    <>
      <TopToolbar
        aiEnabled={aiEnabled}
        onToggleAi={toggleAi}
        docStyle={docStyle}
        onToneRewrite={runDocTone}
        busy={busy !== null}
      />

      <main className="shell">
        <div
          className="paper"
          ref={setPaper}
          onMouseMove={(event) => {
            if (!editor || !aiEnabled) return
            const at = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })
            setHoveredId(at ? getBlockIdAt(editor, at.pos) : null)
          }}
          onMouseLeave={() => setHoveredId(null)}
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
              onDismiss={() => setHoveredId(null)}
            />
          )}

          {editor &&
            pending.map((blockId) => {
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
            ? 'Hover a paragraph for AI actions, or select text inside it first to narrow the edit. Proposals appear inline — accept, reject, or refine each one.'
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
