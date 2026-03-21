import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import SoilSenseApp from './SoilSenseApp.jsx'
import I18nProvider from './i18n/I18nProvider.jsx'
import { createLogger, normalizeErrorForLog } from './lib/logger'

const appLog = createLogger('app')
const pwaLog = createLogger('pwa')

/** Avoid logging arbitrary postMessage payloads (SW may send structured data later). */
function sanitizeServiceWorkerMessageData(data) {
  if (data == null) return null
  if (typeof data === 'string') {
    return data.length > 200 ? `${data.slice(0, 200)}…` : data
  }
  if (typeof data === 'object') {
    const t = data?.type
    return {
      type: typeof t === 'string' ? t : '[non-string]',
      keyCount: Object.keys(data).length,
    }
  }
  return { kind: typeof data }
}

function sanitizeGlobalMessage(msg) {
  if (msg == null) return ''
  const s = String(msg)
  if (/AIza[0-9A-Za-z_-]{10,}/.test(s)) return '[redacted: possible API key in message]'
  return s.length > 800 ? `${s.slice(0, 800)}…` : s
}

window.addEventListener('error', (event) => {
  appLog.error(
    'app.global.error',
    {
      message: sanitizeGlobalMessage(event?.message),
      filename: event?.filename,
      lineno: event?.lineno,
      colno: event?.colno,
    },
    {}
  )
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason
  const err = reason instanceof Error ? reason : new Error(sanitizeGlobalMessage(reason))
  appLog.error('app.global.unhandledrejection', normalizeErrorForLog(err), {})
})

// PWA readiness: register SW only in production.
// In local dev, actively remove old SW/caches to avoid stale UI bundles.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (ev) => {
    pwaLog.info('pwa.sw.message', { data: sanitizeServiceWorkerMessageData(ev?.data) })
  })

  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      pwaLog.info('pwa.sw.register.start', { path: '/sw.js' })
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          pwaLog.info('pwa.sw.register.success', { scope: reg.scope })
        })
        .catch((err) => {
          pwaLog.warn('pwa.sw.register.failed', normalizeErrorForLog(err))
        })
    })
  } else {
    window.addEventListener('load', () => {
      pwaLog.info('pwa.dev.unregisterCaches.start', {})
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => r.unregister())
        pwaLog.info('pwa.dev.unregisterCaches.done', { registrations: regs.length })
      })
      if ('caches' in window) {
        caches.keys().then((keys) => {
          const targets = keys.filter((k) => k.startsWith('soilsense-pwa-'))
          targets.forEach((k) => caches.delete(k))
          pwaLog.info('pwa.dev.cacheCleared', { keysDeleted: targets.length })
        })
      }
    })
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nProvider>
      <SoilSenseApp />
    </I18nProvider>
  </StrictMode>,
)
