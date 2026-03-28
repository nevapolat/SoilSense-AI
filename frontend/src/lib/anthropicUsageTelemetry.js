import { createLogger } from './logger.js'

const usageLog = createLogger('usage')

/** Stable keys for each Anthropic feature (matches claudeProvider call sites). */
export const ANTHROPIC_USAGE_KEYS = {
  soilAdvice: 'soilAdvice',
  compostRecipe: 'compostRecipe',
  knowledgeHub: 'knowledgeHub',
  smartAlert: 'smartAlert',
  soilVitality: 'soilVitality',
  plantScan: 'plantScan',
  dailyTasks: 'dailyTasks',
  locationIntel: 'locationIntel',
  farmDailyInsight: 'farmDailyInsight',
}

const STORAGE_KEY = 'soilsense.anthropicUsage.v1'
const SESSION_STORAGE_KEY = 'soilsense.usage.sessionId'
const MAX_SESSION_HISTORY = 8

function telemetryEnabled() {
  if (import.meta.env.VITE_ANTHROPIC_USAGE_TELEMETRY === 'false') return false
  return import.meta.env.DEV || import.meta.env.VITE_ANTHROPIC_USAGE_TELEMETRY === 'true'
}

function emptyBucket() {
  return { calls: 0, inputTokens: 0, outputTokens: 0 }
}

function emptyTotals() {
  return { calls: 0, inputTokens: 0, outputTokens: 0 }
}

function emptyState() {
  return {
    v: 1,
    allTime: { byKey: {}, totals: emptyTotals() },
    currentSession: null,
    sessionHistory: [],
  }
}

function loadRawState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.v !== 1 || typeof parsed.allTime !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function saveRawState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (err) {
    usageLog.warn('usage.telemetry.persistFailed', { message: err?.message ? String(err.message) : String(err) })
  }
}

function getOrCreateSessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (!id || String(id).trim() === '') {
      id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `s-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      sessionStorage.setItem(SESSION_STORAGE_KEY, id)
    }
    return id
  } catch {
    return `fallback-${Date.now()}`
  }
}

function ensureSessionShape(state, sessionId) {
  if (!state.currentSession || state.currentSession.id !== sessionId) {
    const prev = state.currentSession
    if (prev && prev.id && Array.isArray(state.sessionHistory)) {
      state.sessionHistory = [prev, ...state.sessionHistory].slice(0, MAX_SESSION_HISTORY)
    }
    state.currentSession = {
      id: sessionId,
      startedAt: new Date().toISOString(),
      byKey: {},
      totals: emptyTotals(),
    }
  }
  if (!state.allTime) state.allTime = { byKey: {}, totals: emptyTotals() }
  if (!state.allTime.byKey) state.allTime.byKey = {}
  if (!state.allTime.totals) state.allTime.totals = emptyTotals()
  if (!Array.isArray(state.sessionHistory)) state.sessionHistory = []
}

function addToAggregate(aggregate, endpointKey, inputTokens, outputTokens) {
  if (!aggregate.byKey[endpointKey]) aggregate.byKey[endpointKey] = emptyBucket()
  const b = aggregate.byKey[endpointKey]
  b.calls += 1
  b.inputTokens += inputTokens
  b.outputTokens += outputTokens
  aggregate.totals.calls += 1
  aggregate.totals.inputTokens += inputTokens
  aggregate.totals.outputTokens += outputTokens
}

/**
 * @param {unknown} msg - Anthropic message response
 * @returns {{ input: number, output: number }}
 */
export function usageFromAnthropicMessage(msg) {
  const u = msg && typeof msg === 'object' ? msg.usage : null
  if (!u || typeof u !== 'object') return { input: 0, output: 0 }
  const input = Number(u.input_tokens) || 0
  const output = Number(u.output_tokens) || 0
  return { input, output }
}

/**
 * Record one successful Messages API completion (after retries, one record per successful HTTP response).
 * @param {string} endpointKey - one of ANTHROPIC_USAGE_KEYS values
 * @param {{ input: number, output: number }} usage
 * @param {{ model?: string, correlationId?: string }} [meta]
 */
export function recordAnthropicUsage(endpointKey, usage, meta = {}) {
  if (!telemetryEnabled()) return
  const key = typeof endpointKey === 'string' && endpointKey.trim() ? endpointKey.trim() : 'unknown'
  const inputTokens = Math.max(0, Math.floor(Number(usage?.input) || 0))
  const outputTokens = Math.max(0, Math.floor(Number(usage?.output) || 0))

  const state = loadRawState() || emptyState()
  const sessionId = getOrCreateSessionId()
  ensureSessionShape(state, sessionId)

  addToAggregate(state.currentSession, key, inputTokens, outputTokens)
  addToAggregate(state.allTime, key, inputTokens, outputTokens)

  saveRawState(state)

  usageLog.info(
    'usage.anthropic.recorded',
    {
      endpoint: key,
      inputTokens,
      outputTokens,
      model: meta.model,
      sessionCalls: state.currentSession.byKey[key]?.calls,
      sessionInputTotal: state.currentSession.totals.inputTokens,
      sessionOutputTotal: state.currentSession.totals.outputTokens,
    },
    { correlationId: meta.correlationId }
  )
}

/** Full snapshot for debugging / export (reads latest from localStorage). */
export function getAnthropicUsageTelemetrySnapshot() {
  const state = loadRawState() || emptyState()
  const sessionId = getOrCreateSessionId()
  ensureSessionShape(state, sessionId)
  return {
    enabled: telemetryEnabled(),
    sessionId,
    currentSession: state.currentSession,
    allTime: state.allTime,
    sessionHistory: state.sessionHistory || [],
    storageKey: STORAGE_KEY,
  }
}

/** Clears persisted usage and starts a fresh session id. */
export function resetAnthropicUsageTelemetry() {
  try {
    localStorage.removeItem(STORAGE_KEY)
    sessionStorage.removeItem(SESSION_STORAGE_KEY)
  } catch {
    // ignore
  }
  usageLog.info('usage.anthropic.cleared', {})
}
