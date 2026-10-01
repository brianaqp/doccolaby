# doccolaby

A browser-based Markdown editor where an AI collaborator proposes edits as **inline tracked
changes** you accept, reject, or refine — one paragraph at a time. No chat panel, no sidebar, no
"generate my document" button.

![surface](https://img.shields.io/badge/stack-React%20·%20Vite%20·%20TS%20·%20Tiptap-informational)

## Run it

```bash
npm install
cp .env.example .env     # then put your OpenRouter key in it
npm run dev
```

Open <http://localhost:5173>.

`npm run dev` starts two processes: the Vite dev server (`:5173`) and a small Express proxy
(`:8787`) that Vite proxies `/api` to. The OpenRouter key lives **only** in the proxy's
environment — it is never read as a `VITE_*` variable, so it never reaches the browser bundle.

| env var | default | purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | — | required; the proxy returns a readable 500 without it |
| `OPENROUTER_MODEL` | `google/gemini-2.5-flash-lite` | any OpenRouter model with structured-output support |
| `PORT` | `8787` | proxy port |
| `HOSTNAME` | `localhost` | proxy bind address; `0.0.0.0` exposes it on all interfaces |

## What was built

**Two AI surfaces, deliberately kept apart.**

- **Hover a paragraph** → a floating toolbar appears at its edge: *Rewrite, Shorten, Expand, Fix
  tone*, plus a free-form instruction box. Always scoped to that one block. Select text inside the
  block first and the edit narrows to just that span — the toolbar shows a `selection` chip so the
  scope is never ambiguous.
- **Top toolbar** → document-level only: five whole-document tone presets (Formal, Casual, Concise,
  Persuasive, Friendly) and the AI on/off toggle.

Doc-level actions are unreachable from the hover toolbar and vice versa. Conflating "tighten this
sentence" with "rewrite my whole document" is the fastest way to make an editor feel unsafe.

**Diffs are inline, not side-by-side.** A proposal renders as ProseMirror decorations *inside the
paragraph it affects*: deletions struck through in red, insertions highlighted in green, the block
tinted to show it is under review. You read the change in place, in context, not in a separate
panel you have to mentally re-merge.

**A whole-document rewrite is N independent diffs, never one blob.** The doc-scope request returns
one entry per block, and each becomes its own suggestion with its own Accept / Reject / Refine
controls. You can take the third paragraph's rewrite and drop the fifth's. There is no
all-or-nothing "apply".

**Refine is multi-turn.** Refining sends the model its own previous proposal plus your follow-up, so
"now make it blunter" sharpens what it just wrote instead of starting over from the original text.

**Tone is sticky.** Apply a document tone and that tone is injected into the system prompt of every
later block-level edit, so a single paragraph nudge does not drift back out of the voice you chose.

**AI off means off.** The toggle hides the hover toolbar, blocks every request, and clears any
pending proposals. What is left is a plain Markdown editor.

**Blank page, saved locally.** The editor opens empty, or with your last draft: the markdown is saved
to `localStorage` as you type and read back once on load. **Clear** in the header empties the page
in one undoable step. On a blank page you can describe what you are writing and
`POST /api/propose-structure` returns an outline, which arrives as an ordinary suggestion to accept,
reject or refine. Nothing is written into the document until you accept it.

### How it fits together

```
src/editor/        Tiptap setup, per-block ids, markdown serialization,
                   diff → decoration mapping, accept/reject
src/components/    the two toolbars, the suggestion card, anchor positioning
src/ai/            the fetch client
server/            Express proxy: prompt construction, OpenRouter call
server/routes/     one file per endpoint: ai-action, propose-structure
shared/contract/   one contract per endpoint (+ common.ts) — Zod schemas, inferred types,
                   generated JSON Schema
```

**One contract, three jobs.** `shared/contract/` holds Zod schemas that are the single source of
truth. The TypeScript types are inferred from them (`z.infer`), both the proxy and the browser
validate against them, and the JSON Schema the model is constrained to is *generated* from the same
schema via `z.toJSONSchema()`. Zod emits `additionalProperties: false` with every property required,
which is exactly what OpenRouter's strict mode wants. There is no hand-maintained second copy of the
shape to drift.

**No agentic loop.** The client already knows the target range (hovered block id, or the current
selection), so every action is one request and one response. Adding a capability is a new enum
member in `AI_ACTIONS` plus a client handler — no change to the request cycle.

**Blocks are addressed by stable id.** `@tiptap/extension-unique-id` tags each top-level block, so a
proposal can be held against a specific paragraph while you keep typing elsewhere, and several
proposals can be pending at once without positional bookkeeping.

**The diff runs over markdown, decorations land on text.** The model reads and writes markdown, so
the diff is computed on markdown (otherwise every `#` and `**` would register as a deletion). But
decorations need document text positions. Since the rendered text is a subsequence of the markdown,
a single forward scan aligns the two; if that alignment ever fails, the block falls back to showing
the whole proposal as one insertion widget rather than rendering a wrong diff.

### Cost

`google/gemini-2.5-flash-lite` at $0.10/M in, $0.40/M out. Measured across the end-to-end test runs
in this repo's development: **~$0.0001 per action**, i.e. roughly 50,000 actions inside a $5 cap.
Every call logs its token usage to the proxy's stdout, so spend is visible while you work.

## Trade-offs, and what I'd do next

**Known limits**

- **Markdown scope is deliberately narrow.** Headings, lists, bold/italic, code, blockquotes. No
  tables, images, or footnotes — they add serializer edge cases without testing anything the brief
  asks about.
- **Block granularity is top-level only.** A bullet list is one block, so an action rewrites the
  whole list rather than one item. Addressing list items individually would let the AI rewrite half
  a list while the enclosing block was also under review.
- **`insert_after` grows a block, it doesn't create one.** The contract can only express "replace
  block X's markdown", so an insertion comes back as the original content plus the new content in
  one block. Creating a genuinely new sibling block would need the contract to carry an anchor and
  a position.
- **`delete_section` and `insert_after` are in the contract but not on the toolbar.** They are the
  extension seam the design is built around, proven by the schema and the prompt, not yet surfaced
  as buttons.
- **Suggestion cards are positioned per block and can crowd** on very short adjacent paragraphs
  after a whole-document rewrite.
- **No tests.** For a build at this scope I put the time into making the diff→position mapping
  degrade safely instead. The three things I would actually write tests for are
  `alignMarkdownToText`, `computeDiff`, and the accept path.

**What I'd do next, in order**

1. **Streaming proposals.** At one request per action the wait is dead air; token-by-token
   decoration would make the collaborator feel present.
2. **Accept-all / reject-all for a document rewrite**, as a convenience *on top of* per-block
   review — never replacing it.
3. **Character-level diff inside changed words.** `diffWordsWithSpace` marks a whole word changed
   when one suffix moved; the diff would read better at finer grain.
4. **Debounce and de-duplicate requests** per block. Clicking *Shorten* twice currently fires twice.
5. **Undo integration for accepts.** Accept is a single transaction, so Ctrl-Z works, but the
   suggestion does not come back with it.

## Deliverables

- Code: this repo.
- README: this file.
- AI session transcript: `transcript.md` — exported from the Claude Code session that built this.
