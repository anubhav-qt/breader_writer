import { existsSync, readFileSync } from 'node:fs'
import { defineConfig, type PluginOption } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'

// The certificate `npm run certs` makes with mkcert. Every browser on this Mac trusts it, the
// desktop app's own included.
const certFile = new URL('../.certs/local.pem', import.meta.url)
const keyFile = new URL('../.certs/local-key.pem', import.meta.url)

/** mkcert's certificate, once it's been made. */
function certificate() {
  if (!existsSync(certFile) || !existsSync(keyFile)) {
    return undefined
  }
  return { cert: readFileSync(certFile), key: readFileSync(keyFile) }
}

// HTTPS, since breader's login cookie is Secure and the browser only sends it over HTTPS (see
// "Running it locally" in CLAUDE.md). Without mkcert's certificate, a self-signed one, which a
// browser warns about once and the desktop app refuses.
const https = certificate()
const plugins: PluginOption[] = [react()]
if (!https) {
  plugins.push(basicSsl())
}

// https://vite.dev/config/
export default defineConfig({
  plugins,
  // The writer lives at breader.site/writer, beside breader.
  base: '/writer/',
  server: {
    https,
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
