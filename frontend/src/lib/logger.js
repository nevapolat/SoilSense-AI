/**
 * Structured client-side logging: levels, namespaces, pluggable transports, privacy helpers.
 * @see vite-env.d.ts for VITE_LOG_LEVEL, VITE_ENABLE_DIAGNOSTICS_UI
 */

export const LOG_NAMESPACES = [
  'app',
  'i18n',
  'geo',
  'weather',
  'gemini',
  'claude',
  'storage',
  'pwa',
  'ui',
  'profile',
  'activity',
]

const LOG_NAMESPACE_SET = new Set(LOG_NAMESPACES)
const warnedUnknownNamespaces = new Set()

const LEVEL_RANK = { debug: 0, info: 1, warn: 2, error: 3 }

const RING_STORAGE_KEY = 'soilsense.diagnosticsLogRing'
const RING_MAX = 200

const SENSITIVE_KEY_RE =
  /(api[_-]?key|token|password|secret|authorization|bearer|VITE_GEMINI_API_KEY|VITE_ANTHROPIC_API_KEY|runtimeGemini|runtimeAnthropic)/i

function resolveMinLevel() {
  const raw = import.meta.env.VITE_LOG_LEVEL
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw
  if (import.meta.env.PROD) return 'warn'
  return 'debug'
}

let cachedMinLevel = resolveMinLevel()

export function getLogLevel() {
  return cachedMinLevel
}

/** For tests or hot reload of env (rare). */
export function refreshLogLevelConfig() {
  cachedMinLevel = resolveMinLevel()
}

function shouldEmit(level) {
  const min = LEVEL_RANK[cachedMinLevel] ?? LEVEL_RANK.warn
  const cur = LEVEL_RANK[level] ?? LEVEL_RANK.info
  return cur >= min
}

function truncateString(s, max = 200) {
  const str = String(s)
  if (str.length <= max) return str
  return `${str.slice(0, max)}…`
}

/**
 * Recursively redact secrets and oversized strings from metadata (best-effort).
 */
export function sanitizeMeta(value, depth = 0) {
  if (depth > 6) return '[max-depth]'
  if (value == null) return value
  if (typeof value === 'string') {
    if (SENSITIVE_KEY_RE.test(value)) return '[redacted-string]'
    return truncateString(value, 400)
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => sanitizeMeta(v, depth + 1))
  }
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = '[redacted]'
        continue
      }
      if (k === 'imageBase64' || k === 'data' || k === 'base64') {
        out[k] = typeof v === 'string' ? `[base64 len ${v.length}]` : '[omitted]'
        continue
      }
      out[k] = sanitizeMeta(v, depth + 1)
    }
    return out
  }
  return String(value)
}

export function generateRunId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // ignore
  }
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** Bucket geolocation accuracy for logs (no raw precision in default prod logs). */
export function bucketAccuracyMeters(m) {
  if (typeof m !== 'number' || !Number.isFinite(m)) return 'unknown'
  if (m < 10) return '<10m'
  if (m < 50) return '10-50m'
  if (m < 200) return '50-200m'
  if (m < 1000) return '200m-1km'
  return '>1km'
}

function buildRecord({ level, namespace, event, meta, correlationId, durationMs }) {
  return {
    timestamp: new Date().toISOString(),
    level,
    namespace,
    event,
    ...(durationMs != null && Number.isFinite(durationMs) ? { durationMs: Math.round(durationMs) } : {}),
    ...(correlationId ? { correlationId: String(correlationId) } : {}),
    ...(meta && typeof meta === 'object' && Object.keys(meta).length ? { meta: sanitizeMeta(meta) } : {}),
  }
}

export class ConsoleTransport {
  emit(record) {
    const { level, namespace, event, ...rest } = record
    const line = `[${namespace}] ${event}`
    const payload = { ...rest }
    if (level === 'debug' && typeof console.debug === 'function') {
      console.debug(line, payload)
    } else if (level === 'info' && typeof console.info === 'function') {
      console.info(line, payload)
    } else if (level === 'warn' && typeof console.warn === 'function') {
      console.warn(line, payload)
    } else if (typeof console.error === 'function') {
      console.error(line, payload)
    } else {
      console.log(line, payload)
    }
  }
}

export class LocalStorageRingBufferTransport {
  constructor({ maxEntries = RING_MAX, storageKey = RING_STORAGE_KEY } = {}) {
    this.maxEntries = maxEntries
    this.storageKey = storageKey
  }

  emit(record) {
    if (typeof localStorage === 'undefined') return
    try {
      const prevRaw = localStorage.getItem(this.storageKey)
      const prev = prevRaw ? JSON.parse(prevRaw) : []
      const list = Array.isArray(prev) ? prev : []
      list.push(record)
      while (list.length > this.maxEntries) list.shift()
      localStorage.setItem(this.storageKey, JSON.stringify(list))
    } catch {
      // quota or disabled storage
    }
  }
}

/** Placeholder for a future HTTP endpoint. */
export class RemoteTransport {
  // eslint-disable-next-line no-unused-vars
  emit(_record) {
    /* intentionally empty */
  }
}

/**
 * Dev only: POSTs sanitized records to Vite middleware → prints in the terminal running `npm run dev`.
 * Enable with VITE_LOG_TO_TERMINAL=true (restart dev server after changing .env).
 */
export class DevTerminalTransport {
  emit(record) {
    if (typeof fetch === 'undefined') return
    try {
      fetch('/__soilsense/dev-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
        keepalive: true,
      }).catch(() => {})
    } catch {
      // ignore
    }
  }
}

let transports = []

const DIAGNOSTICS_UI_ENABLED = import.meta.env.VITE_ENABLE_DIAGNOSTICS_UI === 'true'
const TERMINAL_LOG_ENABLED =
  import.meta.env.DEV && import.meta.env.VITE_LOG_TO_TERMINAL === 'true'

function ensureTransports() {
  if (transports.length) return
  transports = [new ConsoleTransport()]
  if (DIAGNOSTICS_UI_ENABLED) {
    transports.push(new LocalStorageRingBufferTransport({ maxEntries: RING_MAX }))
  }
  if (TERMINAL_LOG_ENABLED) {
    transports.push(new DevTerminalTransport())
  }
}

function scheduleEmit(fn) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => fn(), { timeout: 1200 })
    return
  }
  queueMicrotask(fn)
}

/**
 * @param {object} opts
 * @param {'debug'|'info'|'warn'|'error'} opts.level
 * @param {string} opts.namespace
 * @param {string} opts.event stable event key
 * @param {object} [opts.meta]
 * @param {string} [opts.correlationId]
 * @param {number} [opts.durationMs]
 */
export function logEvent(opts) {
  ensureTransports()
  const { level, namespace, event, meta, correlationId, durationMs } = opts
  if (
    import.meta.env.DEV &&
    typeof namespace === 'string' &&
    namespace &&
    !LOG_NAMESPACE_SET.has(namespace) &&
    !warnedUnknownNamespaces.has(namespace)
  ) {
    warnedUnknownNamespaces.add(namespace)
    console.warn(`[logger] unknown namespace "${namespace}" (not in LOG_NAMESPACES)`)
  }
  if (!shouldEmit(level)) return

  const record = buildRecord({ level, namespace, event, meta, correlationId, durationMs })

  const run = () => {
    for (const t of transports) {
      try {
        t.emit(record)
      } catch {
        // never throw from logging
      }
    }
  }

  if (level === 'error' || level === 'warn') {
    run()
    return
  }

  if (import.meta.env.PROD) {
    scheduleEmit(run)
  } else {
    run()
  }
}

export function createLogger(namespace) {
  return {
    debug: (event, meta, extra = {}) =>
      logEvent({ level: 'debug', namespace, event, meta, ...extra }),
    info: (event, meta, extra = {}) =>
      logEvent({ level: 'info', namespace, event, meta, ...extra }),
    warn: (event, meta, extra = {}) =>
      logEvent({ level: 'warn', namespace, event, meta, ...extra }),
    error: (event, meta, extra = {}) =>
      logEvent({ level: 'error', namespace, event, meta, ...extra }),
  }
}

export function getDiagnosticsLogRing() {
  try {
    const raw = localStorage.getItem(RING_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function clearDiagnosticsLogRing() {
  try {
    localStorage.removeItem(RING_STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function isDiagnosticsRingEnabled() {
  return DIAGNOSTICS_UI_ENABLED
}

/** Normalized Error-like object for meta (no stack dumps in production by default). */
export function normalizeErrorForLog(err) {
  const o = {
    message: err?.message != null ? truncateString(String(err.message), 500) : String(err),
  }
  if (err?.name) o.name = String(err.name)
  const status = err?.status ?? err?.statusCode
  if (status != null) o.status = status
  if (!import.meta.env.PROD && err?.stack) {
    o.stackPreview = truncateString(String(err.stack), 800)
  }
  return o
}
