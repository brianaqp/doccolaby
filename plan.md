# Plan: Chiri Engineering Assessment — AI Document Editor

Source: `assestment.pdf`

## What we're building

Single-page, browser-based Markdown editor. AI proposes edits (paragraph or whole doc) as inline
tracked-changes diffs; user accepts/rejects/refines. Feels like a doc editor with a collaborator,
not a chatbot — no sidebar, no chat panel.

## Hard Requirements

1. Markdown editor in the browser
2. AI proposes changes to a paragraph/selection OR the whole doc
3. Proposed changes render as a **visible inline diff** before being applied
4. Accept / reject / refine per suggestion
5. AI on/off toggle — full raw editor when off
6. No auth, no DB, no Docker
7. OpenRouter for LLM calls, cheap model, stay under $5 cap
8. Deliverables: code on GitHub, README (run/what/what's-next), this session transcript committed

Not evaluated: visual polish, framework choice, infra.

## Tech Stack

- **React + Vite + TS**
- **Tiptap** (ProseMirror) with markdown storage — gives selection API + decoration extensibility
- **Express proxy**, one route `POST /api/ai-action` — holds the OpenRouter key server-side
  (never shipped as `VITE_*`). This is the only "backend."
- **`diff` npm package** (`diffWordsWithSpace`), computed client-side, per paragraph
- **Model**: cheap/fast OpenRouter model (e.g. `google/gemini-2.0-flash-001` or
  `anthropic/claude-haiku`) — pick one, confirm pricing before wiring up

## AI response contract (structured output, no tool-calling/MCP)

One JSON object per request, via `response_format: {type: "json_schema"}`:

```json
{ "action": "rewrite" | "shorten" | "expand" | "set_tone" | "delete_section" | "insert_after",
  "targets": [ { "blockId": "string", "content": "string" } ] }
```

- `targets` is an array so a whole-doc action can return multiple per-paragraph rewrites — each
  diffed and reviewable independently, instead of one giant blob.
- No agentic loop: we already know the target range client-side (hover block id or selection), so
  one request/response round-trip per action. Adding a new action = new enum value + client
  handler, no request-loop changes.

## UI surfaces (two scopes, kept separate)

1. **Paragraph hover toolbar** — hovering a block reveals a small floating toolbar at its edge:
   rewrite / shorten / expand / fix-tone buttons + free-form instruction input. Always scoped to
   that block (or active selection within it). Never touches other paragraphs.
2. **Top toolbar** — persistent, doc-level only:
   - Whole-doc tone rewrite, 5 presets: **Formal, Casual, Concise, Persuasive, Friendly**
   - AI on/off toggle — hides hover toolbar, blocks all AI calls when off
3. Doc-level actions are never reachable from the hover toolbar, and vice versa — keeps "regular
   doc" feel instead of conflating block nudges with doc-wide rewrites.

## Request/response flow

1. Every AI call sends `{ scope: "block" | "doc", blockId?, selectionText?, instruction,
   fullDocumentContext, docStyleContext }` to the proxy.
   - `fullDocumentContext`: always included (even for single-block edits) so the model never
     rewrites blind to surrounding style.
   - `docStyleContext`: last whole-doc tone applied this session (or none). Injected into the
     system prompt so subsequent block-level edits stay consistent with it. Updated only when a
     doc-level tone action completes.
2. System prompt: return only the JSON contract above, content only for the target block(s), no
   commentary.
3. Client diffs each returned block's content against its current text (`diffWordsWithSpace`).
4. Render as inline ProseMirror decorations scoped to each affected block: strikethrough deletions,
   highlighted insertions. Whole-doc rewrites render as N independent per-paragraph diffs, each
   accept/reject/refine-able on its own — never one all-or-nothing diff.
5. Accept → `editor.commands.deleteRange` + `insertContentAt` for that block, clear its decoration.
   Reject → clear decoration, keep original. Refine → re-send with the prior proposal + new
   instruction, same blockId, multi-turn.

## Build order

1. Scaffold Vite + React + TS; commit skeleton.
2. Integrate Tiptap, markdown-backed; confirm selection API + per-block node IDs.
3. Express proxy: `POST /api/ai-action`, OpenRouter call, key from env, structured-output schema.
4. Paragraph hover toolbar (buttons + instruction input) → wired to proxy for `scope: "block"`.
5. Diff computation + inline decoration rendering, scoped per block; accept/reject/refine.
6. Top toolbar: 5 tone presets (`scope: "doc"`, multi-block response) + AI on/off toggle.
7. `docStyleContext` session state, injected into every system prompt.
8. Loading/error states; empty-doc starter content.
9. README: run instructions, what was built, trade-offs/what's-next.
10. Commit this session's transcript.
11. Sanity-check OpenRouter spend stays well under $5.

## Explicit non-goals

- No auth, DB, Docker, or real-time multi-user collab (single user + AI, not multiplayer).
- No silent full-doc overwrite — doc-level tone rewrite is opt-in and always renders as
  per-paragraph reviewable diffs, never an instant unscoped replace.
- No full commercial Markdown feature set (tables/images/footnotes) — headings/lists/bold/
  italic/code is enough.
- No chatbot sidebar/chat panel, ever, even as a stretch goal.
