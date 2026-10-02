import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // HTTPS with a self-signed certificate: breader's login cookie is Secure, so the browser only
  // sends it over HTTPS (see "Running it locally" in CLAUDE.md).
  plugins: [react(), basicSsl()],
  // The writer lives at breader.site/writer, beside breader.
  base: '/writer/',
  server: {
    // Opened as https://local.breader.site:5174/writer/ (a hosts entry for 127.0.0.1), so the
    // browser sends breader's login cookie, which is on breader.site and its subdomains.
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    allowedHosts: ['local.breader.site'],
    // The writer's API (npm run api), under the app's own address, as in production.
    proxy: {
      '/writer/api': {
        target: 'http://localhost:8790',
        rewrite: (path) => path.replace(/^\/writer\/api/, ''),
      },
    },
  },
})
