import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  // '' loads every .env var, not just VITE_*. These are only read here to find
  // the proxy; nothing from this object is exposed to the client bundle.
  const env = loadEnv(mode, process.cwd(), '')
  const port = env.PORT ?? '8787'
  // A wildcard bind address isn't something you can connect to.
  const host = !env.HOST || env.HOST === '0.0.0.0' || env.HOST === '::' ? 'localhost' : env.HOST

  return {
    plugins: [react()],
    server: {
      // The Express proxy is the only backend. It holds the OpenRouter key so the
      // browser bundle never sees it.
      proxy: { '/api': `http://${host}:${port}` },
    },
  }
})
