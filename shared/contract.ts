/**
 * The single request/response contract between the browser and the Express proxy.
 *
 * Both sides import this file, so the JSON schema the model is held to and the
 * shape the client diffs against can never drift apart.
 */

/** Everything the AI is allowed to do. Adding an action = one enum member + one client handler. */
export const AI_ACTIONS = [
  'rewrite',
  'shorten',
  'expand',
  'set_tone',
  'delete_section',
  'insert_after',
] as const

export type AiAction = (typeof AI_ACTIONS)[number]

/** Block-scoped actions nudge one paragraph. Doc-scoped actions rewrite the whole document. */
export type AiScope = 'block' | 'doc'

/** The five whole-document tone presets offered in the top toolbar. */
export const TONE_PRESETS = ['formal', 'casual', 'concise', 'persuasive', 'friendly'] as const

export type TonePreset = (typeof TONE_PRESETS)[number]

/** One prior round of a refine conversation, so the model can build on what it already proposed. */
export interface RefineTurn {
  /** What the model previously proposed for this block. */
  proposal: string
  /** The follow-up instruction the user gave on that proposal. */
  instruction: string
}

export interface AiActionRequest {
  scope: AiScope
  action: AiAction
  /** Required for `scope: 'block'` — the UniqueID of the block being edited. */
  blockId?: string
  /** The current markdown of the target block, so the model knows what it is changing. */
  blockText?: string
  /** Set when the user had text selected inside the block rather than targeting the whole block. */
  selectionText?: string
  /** Free-form user instruction. Empty for preset buttons, which rely on `action` alone. */
  instruction?: string
  /** Always sent, even for a single block, so the model never rewrites blind to surrounding style. */
  fullDocumentContext: string
  /** The last whole-doc tone applied this session, so block edits stay consistent with it. */
  docStyleContext?: TonePreset | null
  /** Prior proposal/instruction rounds for this block, oldest first. Enables multi-turn refine. */
  history?: RefineTurn[]
  /** Present for `scope: 'doc'`: every block the model may rewrite. */
  blocks?: Array<{ blockId: string; text: string }>
}

/** One proposed replacement. `content: ''` means "delete this block". */
export interface AiTarget {
  blockId: string
  content: string
}

export interface AiActionResponse {
  action: AiAction
  targets: AiTarget[]
}

export interface AiErrorResponse {
  error: string
}

/**
 * The JSON Schema handed to OpenRouter as `response_format.json_schema`.
 * Kept next to the types it describes so the two stay in sync.
 */
export const AI_RESPONSE_JSON_SCHEMA = {
  name: 'document_edit',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [...AI_ACTIONS],
        description: 'The action that was performed.',
      },
      targets: {
        type: 'array',
        description:
          'One entry per block to change. Omit blocks that should stay exactly as they are.',
        items: {
          type: 'object',
          properties: {
            blockId: {
              type: 'string',
              description: 'The id of the block this content replaces, copied verbatim from the input.',
            },
            content: {
              type: 'string',
              description:
                'The full new markdown for that block, with no commentary. Empty string to delete the block.',
            },
          },
          required: ['blockId', 'content'],
          additionalProperties: false,
        },
      },
    },
    required: ['action', 'targets'],
    additionalProperties: false,
  },
} as const
