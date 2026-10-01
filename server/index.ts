import 'dotenv/config'

import express from 'express'
import type { NextFunction, Request, Response } from 'express'

import type { AiErrorResponse } from '../shared/contract/common.ts'
import { modelInUse } from './openrouter.ts'
import { aiActionRouter } from './routes/aiAction.ts'
import { proposeStructureRouter } from './routes/proposeStructure.ts'

const app = express()

app.use(express.json({ limit: '1mb' }))

app.use('/api', aiActionRouter)
app.use('/api', proposeStructureRouter)

// Catches malformed JSON and oversized bodies from express.json, which tag their
// own status onto the error; anything else is ours and is a 500.
app.use((err: unknown, _req: Request, res: Response<AiErrorResponse>, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : 'Unexpected server error.'
  const status =
    typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : 500
  console.error('[server]', message)
  res.status(status).json({ error: message })
})

const port = Number(process.env.PORT ?? 8787)
// Set HOSTNAME=0.0.0.0 to expose the proxy beyond this machine.
const hostname = process.env.HOSTNAME ?? 'localhost'

app.listen(port, hostname, () => {
  console.log(`AI proxy listening on http://${hostname}:${port} (model: ${modelInUse()})`)
})
