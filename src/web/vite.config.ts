import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API_TARGET = process.env.API_TARGET ?? 'http://localhost:4040'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Keep the dev server on the same contract as production: the app always
    // talks to /api, and here that is proxied to the single-port server.
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
})
