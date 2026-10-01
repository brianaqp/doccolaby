import { Router } from 'express'
import type { Request, Response } from 'express'

import { aiActionRequestSchema } from '../../shared/contract/aiAction.ts'
import type { AiActionResponse } from '../../shared/contract/aiAction.ts'
import { formatZodError } from '../../shared/contract/common.ts'
import type { AiErrorResponse } from '../../shared/contract/common.ts'
import { MISSING_KEY, requestStructuredEdit } from '../openrouter.ts'
import { buildPrompts } from '../prompt.ts'

export const aiActionRouter = Router()

aiActionRouter.post('/ai-action', async (req: Request, res: Response<AiActionResponse | AiErrorResponse>) => {
  const parsed = aiActionRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) })
    return
  }

  if (!process.env.OPENROUTER_API_KEY) {
    res.status(500).json({ error: MISSING_KEY })
    return
  }

  const { system, user } = buildPrompts(parsed.data)

  try {
    res.json(await requestStructuredEdit(system, user))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[ai-action]', message)
    res.status(500).json({ error: message })
  }
})
