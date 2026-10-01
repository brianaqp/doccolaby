import 'dotenv/config'

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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

// In production this process also serves the built client from dist/, so one
// origin hosts both the app and /api. In dev, Vite serves the client instead.
const distDir = fileURLToPath(new URL('../dist', import.meta.url))
if (process.env.NODE_ENV === 'production') {
  if (!existsSync(distDir)) {
    console.error(`[server] ${distDir} not found. Run \`npm run build\` before \`npm start\`.`)
    process.exit(1)
  }
  app.use(express.static(distDir))
}

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
// Set HOST=0.0.0.0 to expose the proxy beyond this machine. Not HOSTNAME: shells
// and Docker set that to the machine name, which would silently change the bind.
const host = process.env.HOST ?? 'localhost'

app.listen(port, host, () => {
  console.log(`AI proxy listening on http://${host}:${port} (model: ${modelInUse()})`)
})
