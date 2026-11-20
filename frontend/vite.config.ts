import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// `vite --mode alt --port 5174` talks to an API on 8001 (a second checkout running beside the main one)
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { '/api': mode === 'alt' ? 'http://localhost:8001' : 'http://localhost:8000' } },
  build: { chunkSizeWarningLimit: 6000 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
}))
