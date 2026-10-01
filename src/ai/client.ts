import type { z } from 'zod'

import { aiActionResponseSchema } from '../../shared/contract/aiAction'
import type { AiActionRequest, AiActionResponse } from '../../shared/contract/aiAction'
import { aiErrorResponseSchema, formatZodError } from '../../shared/contract/common'
import { structureResponseSchema } from '../../shared/contract/structure'
import type { StructureRequest, StructureResponse } from '../../shared/contract/structure'

/** Thrown for anything the user needs to see: bad request, proxy down, model misbehaving. */
export class AiError extends Error {}

async function postJson<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new AiError('Could not reach the AI proxy. Is `npm run dev` still running?')
  }

  const payload: unknown = await res.json().catch(() => null)

  if (!res.ok) {
    const asError = aiErrorResponseSchema.safeParse(payload)
    throw new AiError(asError.success ? asError.data.error : `AI request failed (${res.status})`)
  }

  // Parsed again on this side: the proxy is trusted, but the contract is the thing worth
  // enforcing, and a mismatch here is a bug worth seeing rather than a silent render.
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new AiError(`The AI returned something unexpected — ${formatZodError(parsed.error)}`)
  }
  return parsed.data
}

export function requestAiAction(body: AiActionRequest): Promise<AiActionResponse> {
  return postJson('/api/ai-action', body, aiActionResponseSchema)
}

export function requestStructure(body: StructureRequest): Promise<StructureResponse> {
  return postJson('/api/propose-structure', body, structureResponseSchema)
}
