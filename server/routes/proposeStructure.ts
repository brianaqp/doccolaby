import { Router } from 'express'
import type { Request, Response } from 'express'

import { formatZodError } from '../../shared/contract/common.ts'
import type { AiErrorResponse } from '../../shared/contract/common.ts'
import { structureRequestSchema } from '../../shared/contract/structure.ts'
import type { StructureResponse } from '../../shared/contract/structure.ts'
import { MISSING_KEY, requestStructureProposal } from '../openrouter.ts'
import { buildStructurePrompts } from '../prompt.ts'

export const proposeStructureRouter = Router()

proposeStructureRouter.post(
  '/propose-structure',
  async (req: Request, res: Response<StructureResponse | AiErrorResponse>) => {
    const parsed = structureRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: formatZodError(parsed.error) })
      return
    }

    if (!process.env.OPENROUTER_API_KEY) {
      res.status(500).json({ error: MISSING_KEY })
      return
    }

    const { system, user } = buildStructurePrompts(parsed.data)

    try {
      res.json(await requestStructureProposal(system, user))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[propose-structure]', message)
      res.status(500).json({ error: message })
    }
  },
)
