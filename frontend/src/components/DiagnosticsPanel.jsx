import { useCallback, useState, useSyncExternalStore } from 'react'
import {
  clearDiagnosticsLogRing,
  getDiagnosticsLogRing,
  isDiagnosticsRingEnabled,
} from '../lib/logger'

let soilsenseHistorySearchPatched = false

/**
 * Re-subscribes when the URL query changes (popstate, pushState, replaceState).
 */
function subscribeToSearchString(onChange) {
  if (typeof window === 'undefined') return () => {}

  window.addEventListener('popstate', onChange)
  window.addEventListener('soilsense-locationsearch', onChange)

  if (!soilsenseHistorySearchPatched) {
    soilsenseHistorySearchPatched = true
    const { pushState, replaceState } = history
    history.pushState = function patchedPushState(...args) {
      const r = pushState.apply(this, args)
      window.dispatchEvent(new Event('soilsense-locationsearch'))
      return r
    }
    history.replaceState = function patchedReplaceState(...args) {
      const r = replaceState.apply(this, args)
      window.dispatchEvent(new Event('soilsense-locationsearch'))
      return r
    }
  }

  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener('soilsense-locationsearch', onChange)
  }
}

function getSearchStringSnapshot() {
  return typeof window !== 'undefined' ? window.location.search : ''
}

function useDiagnosticsVisible() {
  const search = useSyncExternalStore(subscribeToSearchString, getSearchStringSnapshot, () => '')
  if (!isDiagnosticsRingEnabled()) return false
  return new URLSearchParams(search).get('diagnostics') === '1'
}

export default function DiagnosticsPanel() {
  const visible = useDiagnosticsVisible()
  const [logs, setLogs] = useState(() => getDiagnosticsLogRing())

  const refresh = useCallback(() => setLogs(getDiagnosticsLogRing()), [])

  const onCopy = useCallback(async () => {
    const text = JSON.stringify(logs, null, 2)
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        window.prompt('Copy logs', text)
      }
    } catch {
      window.prompt('Copy logs', text)
    }
  }, [logs])

  const onClear = useCallback(() => {
    clearDiagnosticsLogRing()
    refresh()
  }, [refresh])

  const onExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `soilsense-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [logs])

  if (!visible) return null

  return (
    <div
      className="diagnostics-panel"
      style={{
        position: 'fixed',
        right: 12,
        bottom: 88,
        width: 'min(520px, calc(100vw - 24px))',
        maxHeight: '42vh',
        overflow: 'auto',
        zIndex: 2000,
        background: 'var(--card, #fff)',
        border: '1px solid rgba(0,0,0,0.12)',
        borderRadius: 12,
        boxShadow: '0 10px 30px rgba(0,0,0,0.12)',
        padding: 12,
        fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <strong>Diagnostics</strong>
        <span className="muted" style={{ fontSize: 11 }}>
          {logs.length} / 200
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <button type="button" className="btn btn-primary" style={{ fontSize: 12, padding: '6px 10px' }} onClick={refresh}>
          Refresh
        </button>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 10px' }} onClick={onCopy}>
          Copy
        </button>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 10px' }} onClick={onClear}>
          Clear
        </button>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 10px' }} onClick={onExport}>
          Export JSON
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: '28vh',
          overflow: 'auto',
          fontSize: 11,
          lineHeight: 1.35,
          opacity: 0.95,
        }}
      >
        {logs.length ? JSON.stringify(logs, null, 2) : 'No ring-buffer entries yet.'}
      </pre>
    </div>
  )
}
