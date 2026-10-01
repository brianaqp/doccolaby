import { AI_ACTIONS } from '../shared/contract.ts'
import type { AiAction, AiActionRequest } from '../shared/contract.ts'

export interface Prompts {
  system: string
  user: string
}

const ACTION_GUIDANCE: Record<AiAction, string> = {
  rewrite:
    'rewrite — Improve clarity, flow and word choice. Keep the meaning, the facts and roughly the original length.',
  shorten:
    'shorten — Cut the text down hard. Drop filler, hedging and repetition; keep every point that carries information.',
  expand:
    'expand — Develop the existing point with one or two more sentences of real substance. Do not pad with restatement.',
  set_tone:
    'set_tone — Recast the wording in the requested tone. The instruction names the tone. Change how it reads, never the facts.',
  delete_section:
    'delete_section — Return the target block with content set to an empty string (""). Return nothing else.',
  insert_after:
    'insert_after — Return the target block\'s existing content unchanged, then a blank line, then the new content, as that one block\'s markdown.',
}

function systemPrompt(req: AiActionRequest): string {
  const lines = [
    'You are a careful copy-editor working directly inside a user\'s markdown document, as a collaborator rather than a chatbot.',
    '',
    'Output rules — these are absolute:',
    '- Reply with a single JSON object matching the required schema: { "action": string, "targets": [{ "blockId": string, "content": string }] }.',
    '- No commentary, no explanation, no apology, no preamble, no markdown code fences around the JSON.',
    '- Put content only in the target block(s) you were asked to change. Never touch or return any other block.',
    '- Copy every blockId verbatim from the input. Never invent, renumber or reformat an id.',
    '- Omit blocks you are leaving unchanged. An empty targets array means "no change needed".',
    '- Preserve each block\'s own markdown structure: a heading stays a heading at the same level, a list stays a list with the same markers, a blockquote stays a blockquote, a code block keeps its fences and language.',
    '- content is the full replacement markdown for that block, not a diff and not a fragment.',
    `- Echo the requested action back in the "action" field: "${req.action}".`,
  ]

  if (req.docStyleContext) {
    lines.push(
      '',
      `The document's established tone is ${req.docStyleContext} — the user applied that tone to the whole document. Keep this edit consistent with it.`,
    )
  }

  lines.push('', 'Actions and what each one means:')
  for (const action of AI_ACTIONS) {
    lines.push(`- ${ACTION_GUIDANCE[action]}`)
  }

  lines.push(
    '',
    req.scope === 'block'
      ? 'This request is block-scoped: exactly one block may change, and targets must contain that one block.'
      : [
          'This request is document-scoped: the user asked for the whole document to be recast, so this is not a request to find the one weakest paragraph.',
          'Return one targets entry for every block whose wording should change. For a tone change that is normally most of the prose blocks, not one of them.',
          'Omit a block only when recasting it genuinely cannot serve the request — a bare heading that already fits, or a code block.',
        ].join('\n'),
  )

  return lines.join('\n')
}

function userPrompt(req: AiActionRequest): string {
  const sections: string[] = [
    [
      'DOCUMENT (reference only — it shows the surrounding style. Do not rewrite anything outside the target.)',
      '---',
      req.fullDocumentContext,
      '---',
    ].join('\n'),
  ]

  if (req.scope === 'block') {
    const target = ['TARGET BLOCK', `blockId: ${req.blockId}`, 'current markdown:', '---', req.blockText ?? '', '---']
    if (req.selectionText) {
      target.push(
        `The user selected this span inside the block: "${req.selectionText}"`,
        'Change only that span. Return the whole block\'s markdown with the rest of it byte-for-byte identical.',
      )
    }
    sections.push(target.join('\n'))
  } else {
    const blocks = req.blocks ?? []
    sections.push(
      [
        'TARGET BLOCKS (one `[blockId] text` line each)',
        '---',
        ...blocks.map((block) => `[${block.blockId}] ${block.text}`),
        '---',
        'Return one targets entry per block that needs changing, with its blockId copied verbatim.',
      ].join('\n'),
    )
  }

  if (req.history?.length) {
    const rounds = req.history.flatMap((turn, i) => [
      `Round ${i + 1} — you proposed:`,
      turn.proposal,
      `Round ${i + 1} — the user asked for: ${turn.instruction}`,
    ])
    sections.push(
      [
        'EARLIER ROUNDS ON THIS TARGET',
        ...rounds,
        'Build on your most recent proposal above and apply the latest instruction to it. Do not start over from the original text.',
      ].join('\n'),
    )
  }

  const instruction = req.instruction?.trim()
  if (instruction) {
    sections.push(`USER INSTRUCTION\n${instruction}`)
  }

  return sections.join('\n\n')
}

export function buildPrompts(req: AiActionRequest): Prompts {
  return { system: systemPrompt(req), user: userPrompt(req) }
}
