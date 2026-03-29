import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const frontendNodeModules = path.resolve(__dirname, 'node_modules')

/**
 * Kaynak `features/soil-sense/` altında olduğunda bare import'lar (react, lucide-react, …)
 * yukarı çıkan `node_modules` yerine `frontend/node_modules` üzerinden çözülsün (Linux/Netlify uyumlu).
 */
function resolveSoilSenseDepsFromFrontend() {
  return {
    name: 'soilsense-resolve-from-frontend-nm',
    enforce: 'pre',
    resolveId(id, importer) {
      if (!importer) return null
      if (!importer.replace(/\\/g, '/').includes('/features/soil-sense/')) return null
      if (id.startsWith('\0')) return null
      if (id.startsWith('.') || path.isAbsolute(id)) return null
      try {
        return require.resolve(id, { paths: [frontendNodeModules] })
      } catch {
        return null
      }
    },
  }
}

/** Forwards structured client logs to the dev server terminal (see VITE_LOG_TO_TERMINAL in logger). */
function devClientLogToTerminalPlugin() {
  return {
    name: 'soilsense-dev-client-log',
    configureServer(server) {
      server.middlewares.use('/__soilsense/dev-log', (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }
        let body = ''
        let total = 0
        req.on('data', (chunk) => {
          total += chunk.length
          if (total <= 65536) body += chunk
        })
        req.on('end', () => {
          try {
            const rec = JSON.parse(body)
            const meta =
              rec.meta != null && typeof rec.meta === 'object' && Object.keys(rec.meta).length
                ? ` ${JSON.stringify(rec.meta)}`
                : ''
            const rid = rec.correlationId ? ` ${String(rec.correlationId).slice(0, 8)}…` : ''
            const dur = rec.durationMs != null ? ` ${rec.durationMs}ms` : ''
            console.log(
              `[client] ${rec.timestamp || ''} ${rec.level} [${rec.namespace}] ${rec.event}${dur}${rid}${meta}`
            )
          } catch {
            console.log('[client] (invalid log JSON)', body.slice(0, 400))
          }
          res.statusCode = 204
          res.end()
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [resolveSoilSenseDepsFromFrontend(), react(), tailwindcss(), devClientLogToTerminalPlugin()],
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
  },
})
