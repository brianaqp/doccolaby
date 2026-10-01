import { z } from 'zod'

import { toResponseFormat } from './common.ts'

/** Contract for `POST /api/ai-action`: block- and document-scoped edits. */

/** Everything the AI is allowed to do. Adding an action = one enum member + one client handler. */
export const AI_ACTIONS = [
  'rewrite',
  'shorten',
  'expand',
  'set_tone',
  'delete_section',
  'insert_after',
] as const

/** The five whole-document tone presets offered in the top toolbar. */
export const TONE_PRESETS = ['formal', 'casual', 'concise', 'persuasive', 'friendly'] as const

export const aiActionSchema = z.enum(AI_ACTIONS)

/**
 * Block-scoped actions nudge one paragraph. Selection-scoped actions edit exactly the blocks the
 * user selected. Doc-scoped actions rewrite the whole document.
 */
export const aiScopeSchema = z.enum(['block', 'selection', 'doc'])

export const tonePresetSchema = z.enum(TONE_PRESETS)

/** One prior round of a refine conversation, so the model can build on what it already proposed. */
export const refineTurnSchema = z.object({
  /** What the model previously proposed for this block. */
  proposal: z.string(),
  /** The follow-up instruction the user gave on that proposal. */
  instruction: z.string(),
})

export const aiActionRequestSchema = z
  .object({
    scope: aiScopeSchema,
    action: aiActionSchema,
    /** Required for `scope: 'block'` — the UniqueID of the block being edited. */
    blockId: z.string().min(1).optional(),
    /** The current markdown of the target block, so the model knows what it is changing. */
    blockText: z.string().optional(),
    /** Set when the user had text selected inside the block rather than targeting the whole block. */
    selectionText: z.string().optional(),
    /** Free-form user instruction. Empty for preset buttons, which rely on `action` alone. */
    instruction: z.string().optional(),
    /** Always sent, even for a single block, so the model never rewrites blind to surrounding style. */
    /** NOTE: This can be a burn token feature! It's ok for small docs, but will require better context engineering techniques */
    fullDocumentContext: z.string(),
    /** The last whole-doc tone applied this session, so block edits stay consistent with it. */
    docStyleContext: tonePresetSchema.nullish(),
    /** Prior proposal/instruction rounds for this block, oldest first. Enables multi-turn refine. */
    history: z.array(refineTurnSchema).optional(),
    /** Present for `scope: 'selection'` and `scope: 'doc'`: every block the model may rewrite. */
    blocks: z.array(z.object({ blockId: z.string().min(1), text: z.string() })).optional(),
  })
  // The scope decides which fields are mandatory, so the shape is refined rather than split
  // into two types the client would have to narrow at every call site.
  .refine((req) => req.scope !== 'block' || typeof req.blockId === 'string', {
    path: ['blockId'],
    message: "`blockId` is required when scope is 'block'.",
  })
  .refine((req) => req.scope === 'block' || (req.blocks?.length ?? 0) > 0, {
    path: ['blocks'],
    message: "`blocks` must be a non-empty array when scope is 'selection' or 'doc'.",
  })

/** One proposed replacement. `content: ''` means "delete this block". */
export const aiTargetSchema = z.object({
  blockId: z
    .string()
    .describe('The id of the block this content replaces, copied verbatim from the input.'),
  content: z
    .string()
    .describe(
      'The full new markdown for that block, with no commentary. Empty string to delete the block.',
    ),
})

/** What the model must return, and what the client is allowed to act on. */
export const aiActionResponseSchema = z.object({
  action: aiActionSchema.describe('The action that was performed.'),
  targets: z
    .array(aiTargetSchema)
    .describe('One entry per block to change. Omit blocks that should stay exactly as they are.'),
})

export const AI_RESPONSE_JSON_SCHEMA = toResponseFormat('document_edit', aiActionResponseSchema)

export type AiAction = z.infer<typeof aiActionSchema>
export type AiScope = z.infer<typeof aiScopeSchema>
export type TonePreset = z.infer<typeof tonePresetSchema>
export type RefineTurn = z.infer<typeof refineTurnSchema>
export type AiActionRequest = z.infer<typeof aiActionRequestSchema>
export type AiTarget = z.infer<typeof aiTargetSchema>
export type AiActionResponse = z.infer<typeof aiActionResponseSchema>
