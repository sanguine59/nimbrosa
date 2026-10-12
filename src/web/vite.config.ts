import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API_TARGET = process.env.API_TARGET ?? 'http://localhost:3001'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The app always talks to a same-origin /api, in dev and in production
    // alike. Here that is proxied to the read API from src/api.ts.
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
})
