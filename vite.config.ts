import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      // The API runs as a separate `npm run server` process (see server/index.ts).
      '/api': `http://localhost:${process.env.PORT ?? 8787}`,
    },
  },
})
