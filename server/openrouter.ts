import type { z } from 'zod'

import { AI_RESPONSE_JSON_SCHEMA, aiActionResponseSchema } from '../shared/contract/aiAction.ts'
import type { AiActionResponse } from '../shared/contract/aiAction.ts'
import { formatZodError } from '../shared/contract/common.ts'
import type { ResponseFormat } from '../shared/contract/common.ts'
import { STRUCTURE_RESPONSE_JSON_SCHEMA, structureResponseSchema } from '../shared/contract/structure.ts'
import type { StructureResponse } from '../shared/contract/structure.ts'

export const MISSING_KEY =
  'OPENROUTER_API_KEY is not set. Copy .env.example to .env and put your OpenRouter key in it, then restart the server.'

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

export const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite'

export function modelInUse(): string {
  return process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL
}

/** Truncated so a model that answers with an essay does not flood the error message. */
function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 300 ? `${flat.slice(0, 300)}…` : flat
}

/**
 * The model is constrained by the JSON Schema generated from `aiActionResponseSchema`, but
 * `strict` is a provider-side promise rather than a guarantee, so the reply is parsed against
 * that same schema before it is allowed anywhere near the client.
 */
function parseResponse<T>(content: string, schema: z.ZodType<T>): T {
  let json: unknown
  try {
    json = JSON.parse(content)
  } catch {
    throw new Error(`The model replied with text instead of JSON: "${preview(content)}"`)
  }

  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    throw new Error(`The model reply did not match the contract — ${formatZodError(parsed.error)}`)
  }
  return parsed.data
}

/**
 * Asks OpenRouter for one structured reply. `require_parameters` keeps the request
 * on providers that actually honour the JSON schema instead of silently ignoring it.
 */
async function requestStructured<T>(
  system: string,
  user: string,
  responseFormat: ResponseFormat,
  schema: z.ZodType<T>,
): Promise<T> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set.')

  const model = modelInUse()

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_schema', json_schema: responseFormat },
      provider: { require_parameters: true },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OpenRouter returned ${res.status} ${res.statusText}: ${preview(body)}`)
  }

  const payload = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: unknown
  }

  console.log(`[openrouter] ${model} usage:`, payload.usage ?? '(none reported)')

  const content = payload.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('OpenRouter returned no message content.')
  }

  return parseResponse(content, schema)
}

export function requestStructuredEdit(system: string, user: string): Promise<AiActionResponse> {
  return requestStructured(system, user, AI_RESPONSE_JSON_SCHEMA, aiActionResponseSchema)
}

export function requestStructureProposal(system: string, user: string): Promise<StructureResponse> {
  return requestStructured(system, user, STRUCTURE_RESPONSE_JSON_SCHEMA, structureResponseSchema)
}
