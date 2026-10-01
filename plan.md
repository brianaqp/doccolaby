# Plan: Chiri Engineering Assessment — AI Document Editor

Source: `assestment.pdf`

## The Challenge (restated)

A single-page, browser-based, collaborative AI Markdown editor. The user writes Markdown; an AI
agent suggests edits (whole doc or a selection) as visible diffs; the user accepts/rejects/refines.
"Google Docs meets AI pair-writing" — the AI is a collaborator, not a sidebar chatbot, and never
auto-completes the whole document unprompted.

## Hard Requirements

1. Markdown editor in the browser (prebuilt component OK — Tiptap, CodeMirror, Milkdown, etc.)
2. AI agent can propose changes to the full document or a selection
3. Proposed changes render as a **visible diff** before being applied
4. User can **accept / reject / refine** each suggestion
5. Feel collaborative — not a chat window bolted to the side, not "generate whole doc"
6. No auth, no DB, no Docker — single-page app, keep infra minimal
7. Uses OpenRouter (given key, $5 cap) for the LLM calls — must pick a cheap/capable model
8. Deliverables:
   - Code pushed to GitHub/GitLab
   - README: how to run, what was built, what you'd do differently
   - **AI session transcript committed to the repo** (this Claude Code session — non-negotiable)

## Evaluation Criteria (what to optimize for)

- **Experience**: works instantly, no docs needed, obviously useful on first try
- **AI integration quality**: diffs are clear/useful, feels like a real collaborator
- **AI-assisted build process**: effective use of AI tooling, explainable decisions
- **Code quality**: organized, readable, teammate-picklable
- **Taste/judgment**: what was cut and why — trade-offs matter more than feature count

Explicitly NOT evaluated: visual polish, framework choice, infra (Docker/DB/auth).

## Tech Stack (proposed)

- **Framework**: React + Vite + TypeScript — fast to scaffold, ecosystem fit for Tiptap, easy for a
  reviewer to pick up. (Any framework is fine per spec; React chosen for speed + familiarity.)
- **Editor**: Tiptap (ProseMirror-based) with Markdown storage/serialization
  (`tiptap-markdown` or store markdown directly and re-parse). Gives us selection APIs,
  a document model, and extensibility for a custom "suggestion" mark/decoration.
- **Diff rendering**: Track-changes-style inline decorations in the editor (ProseMirror
  decorations: strikethrough for deletions, highlighted insertions) rather than a separate
  before/after pane — feels more "collaborative editing," less "chatbot output."
  - Fallback/simpler alternative: side-by-side diff view using `diff` (npm) + a virtual
    "proposed" document, if inline decorations prove too time-expensive.
- **AI calls**: **Minimal Node/Express proxy is required, not optional** — the OpenRouter key must
  never be shipped to the browser as a `VITE_*`/client-side env var (anything bundled by Vite is
  visible in the served JS). The proxy holds the key server-side, exposes one endpoint
  (`POST /api/ai-action`), and forwards to OpenRouter. Still "simple," not "infrastructure" — one
  file, no DB, no auth, no Docker.
- **Diff computation**: `diff` npm package (`diffWordsWithSpace`) run **client-side** on
  `{ currentSpanText, proposedContent }` to produce word-level add/remove chunks. This is what
  gives us a clean, readable diff — not a raw before/after block swap. Render the chunks as
  `<del>`/`<ins>`-styled spans inside the suggestion overlay card (Path C), scoped to the target
  range only. Only on **accept** does the editor mutate, via
  `editor.commands.insertContentAt(range, content)` (or `deleteRange` + `insertContentAt`) —
  the diff view itself never touches editor state.
- **Model choice**: something fast/cheap on OpenRouter (e.g. `anthropic/claude-...-haiku`,
  `openai/gpt-4o-mini`, or `google/gemini-flash`) to stay well under $5 cap across dev+demo.
- **State/diff logic**: plain React state for document + pending suggestion; `diff-match-patch`
  or `diff` package to compute word/line-level diffs between current doc and AI-proposed doc.
- **Styling**: minimal CSS or Tailwind — enough to be usable, not pixel-perfect.
- **No** database, no auth, no Docker — per spec.

## Decision: Structured Output over Tool-Calling / MCP

To support multiple AI action types (rewrite, shorten, expand, set tone, delete section, insert
after, etc.) without over-engineering, we use **structured output** (JSON schema response via
OpenRouter's `response_format: {type: "json_schema"}`), not agentic tool-calling or MCP.

- Single request/response per AI action — the model returns one JSON object, e.g.:
  ```json
  { "action": "rewrite" | "shorten" | "expand" | "set_tone" | "delete_section" | "insert_after",
    "target": { "from": number, "to": number } | "selection",
    "content": "..." }
  ```
- The **client** applies the resulting action deterministically — same diff/accept-reject flow
  regardless of which action was returned. Adding a new action later is just adding an enum value
  and a client-side handler, not restructuring the request loop.
- Rejected tool-calling/MCP because it implies a multi-round agentic loop (model calls a tool,
  observes result, decides again) which isn't needed here: we already know the target range from
  the user's selection, so the model only needs to classify intent + produce content in one shot.
- Keeps the implementation aligned with the spec's "don't add infrastructure you don't need"
  guidance while still feeling multi-capable rather than single-purpose.

## Core Interaction Design

1. User selects text (or none = whole doc) and triggers an AI action:
   - Free-form instruction box ("make this more formal", "shorten this section")
   - Optional: quick-action buttons / slash command for common ops (fix tone, shorten, expand)
2. Send `{ selection, fullDocumentContext, instruction }` to backend/OpenRouter with a system
   prompt constraining the model to return **only the rewritten span** (plus maybe rationale),
   not the whole doc.
3. Compute diff between original selection and AI's proposed replacement.
4. Render diff inline in the editor (deletions struck through, insertions highlighted) scoped to
   the affected range only.
5. User can:
   - Accept → apply the change, clear decorations
   - Reject → discard, restore original
   - Refine → send follow-up instruction, AI revises its own last suggestion (multi-turn)
6. Keep a lightweight in-memory history of AI-assisted edits (stretch: simple version list).

## Possible Paths to Execution

### Path A — Tiptap + inline tracked-changes decorations (recommended)
- Pros: closest to "feels collaborative"/"tracked changes" ideal in the spec; reuses
  battle-tested editor; selection handling built in.
- Cons: writing ProseMirror decorations for diffs is the most technically involved piece;
  biggest time sink.
- Best if: time budget ~5-6 hrs and want the strongest "AI integration quality" score.

### Path B — Plain textarea/CodeMirror + split-pane before/after diff view
- Pros: much faster to build; diff rendering is just two text panes + a diff lib; less editor
  plumbing.
- Cons: less "inline collaborative" feel — closer to the "sidebar" pattern the spec says to avoid,
  though a split-pane is explicitly listed as an accepted idea. Mitigate by keeping the AI action
  scoped to selections, not whole-doc regen, and keeping interaction snappy.
- Best if: time-constrained (~3-4 hrs), want a robust, low-risk build to guarantee a working demo.

### Path C — Hybrid: Tiptap editor + lightweight custom "suggestion overlay" (not full PM decorations)
- Render the doc in Tiptap for editing, but implement suggestions as a simple overlay: highlight
  the selected range, show a floating card with inline diff text (old vs new) rather than true
  ProseMirror decorations.
- Pros: keeps a nice editor and selection UX without the full complexity of custom PM decoration
  plugins; diff card is easy to build with `diff` npm package.
- Cons: slightly less "seamless" than true inline tracked changes, but still clearly not a
  sidebar chatbot.
- Best if: want strong UX with moderate implementation risk — good middle ground.

**Recommendation: Path C**, with Path A's inline-decoration polish added only if time remains.
Gives the best experience-per-hour ratio and directly satisfies "visible diffs" +
"feels collaborative" without betting the whole timeline on custom ProseMirror plugin work.

## Suggested Build Order

1. Scaffold Vite + React + TS app; commit skeleton.
2. Integrate Tiptap with Markdown-backed content; verify selection API works.
3. Build minimal Express (or serverless function) proxy for OpenRouter calls, keyed by env var.
4. Wire up "AI action" UI: instruction input + selection capture + submit.
5. Implement diff computation (word-level via `diff` package) + suggestion card/overlay UI.
6. Implement accept/reject/refine flow, including multi-turn refinement of a pending suggestion.
7. Add 2-3 quick-action presets (fix tone, shorten, expand) as sugar over the instruction box.
8. Polish: loading states, error handling for API failures, basic empty-state doc.
9. Write README (run instructions, what was built, what's next).
10. Export/commit this Claude Code session transcript into the repo.
11. Final pass: verify $5 OpenRouter cap isn't at risk (cheap model, short context).

## Explicit Non-Goals (for "taste & judgment" section of README)

- No auth, no persistence/DB, no Docker.
- No real-time multi-user collaboration (single user only, per spec's "user always in control").
  The spec frames this as one user + an AI collaborator, not multiplayer editing. Real-time sync
  (Yjs/CRDT, websocket server, presence, conflict resolution) is exactly the kind of "infra" the
  spec says isn't evaluated — adding it would burn time budget better spent on diff/AI-interaction
  quality, which is scored.
- No full document regeneration on a single click — every AI action stays scoped.
- No attempt at a full commercial-grade Markdown editor (tables, images, footnotes) —
  headings/lists/bold/italic/code is enough to demonstrate the interaction.
- **No chatbot sidebar/right panel.** All AI interaction happens in-context via the selection →
  instruction → popup diff (accept/reject/refine) flow described above. A persistent chat panel is
  exactly the "sidebar chatbot" pattern the spec says to avoid — do not add one, even as a stretch
  goal.
