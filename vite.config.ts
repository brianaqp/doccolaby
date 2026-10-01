import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    // The Express proxy is the only backend. It holds the OpenRouter key so the
    // browser bundle never sees it.
    proxy: { '/api': 'http://localhost:8787' },
  },
})
