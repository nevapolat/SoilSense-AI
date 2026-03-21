import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import SoilSenseApp from './SoilSenseApp.jsx'
import I18nProvider from './i18n/I18nProvider.jsx'

// PWA readiness: register SW only in production.
// In local dev, actively remove old SW/caches to avoid stale UI bundles.
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Non-fatal: app should still work without PWA support.
      })
    })
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => r.unregister())
      })
      if ('caches' in window) {
        caches.keys().then((keys) => {
          keys
            .filter((k) => k.startsWith('soilsense-pwa-'))
            .forEach((k) => caches.delete(k))
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
