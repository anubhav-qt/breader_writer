import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The writer lives at breader.site/writer, beside breader.
  base: '/writer/',
  server: {
    // Bind to IPv4 so both http://localhost:5174 and http://127.0.0.1:5174 work in every browser.
    host: '127.0.0.1',
    port: 5174,
    // The writer's API (npm run api), under the app's own address, as in production.
    proxy: {
      '/writer/api': {
        target: 'http://localhost:8790',
        rewrite: (path) => path.replace(/^\/writer\/api/, ''),
      },
    },
  },
})
