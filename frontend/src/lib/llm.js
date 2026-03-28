import {
  ANTHROPIC_USAGE_KEYS,
  getAnthropicUsageTelemetrySnapshot,
  resetAnthropicUsageTelemetry,
} from './anthropicUsageTelemetry.js'
import * as claude from './claudeProvider.js'
import { buildSoilVitalityScoreFallback } from './llmShared.js'
import { extractJson } from './llmJson.js'

/**
 * LLM backend is Anthropic Claude only (`VITE_ANTHROPIC_API_KEY`).
 * Soil health advisor uses the primary model (default Haiku; see `getResolvedClaudeSoilAdviceModelName` in claudeProvider).
 */
export function getLlmProvider() {
  return 'claude'
}

/** True when the failure is missing/disallowed LLM env key (not a transient network error). */
export function isLlmConfigurationError(err) {
  const msg = err?.message != null ? String(err.message) : String(err)
  return /VITE_ANTHROPIC_(API_KEY|HAIKU_API_KEY)|API key is not configured|frontend[\\/]\.env|dev server|restart the dev server/i.test(
    msg
  )
}

/**
 * For missing/invalid API key errors we return an empty string so the UI does not show the long
 * Netlify/.env instructions. Other errors return as-is.
 */
export function formatLlmConfigErrorForUi(err) {
  if (isLlmConfigurationError(err)) return ''
  return err?.message != null ? String(err.message) : String(err)
}

let runtimePreferredLanguage = ''

export function setGlobalPreferredLanguage(lang) {
  const normalized = typeof lang === 'string' ? lang.trim().toLowerCase() : ''
  runtimePreferredLanguage = normalized
}

function resolvePreferredLanguage(explicitLang) {
  const fromArg = typeof explicitLang === 'string' ? explicitLang.trim().toLowerCase() : ''
  if (fromArg) return fromArg
  if (runtimePreferredLanguage) return runtimePreferredLanguage
  try {
    const stored = localStorage.getItem('soilsense.lang')
    if (stored && typeof stored === 'string') return stored.trim().toLowerCase()
  } catch {
    // ignore
  }
  return 'en'
}

function withPreferredLanguage(opts) {
  const base = opts && typeof opts === 'object' ? opts : {}
  const preferredLanguage = resolvePreferredLanguage(base.lang)
  return {
    ...base,
    lang: preferredLanguage,
    preferred_language: preferredLanguage,
  }
}

export function getResolvedActiveModelName() {
  return claude.getResolvedClaudeModelName()
}

/** All Claude calls use Haiku (see `getClaudeHaikuRoutingInfo`). */
export function getClaudeHaikuRoutingInfo() {
  return claude.getClaudeHaikuRoutingInfo()
}

export { ANTHROPIC_USAGE_KEYS, getAnthropicUsageTelemetrySnapshot, resetAnthropicUsageTelemetry }

export function setRuntimeGeminiApiKey(key) {
  return claude.setRuntimeAnthropicApiKey(key)
}

export function clearRuntimeGeminiApiKey() {
  return claude.clearRuntimeAnthropicApiKey()
}

export function getRuntimeGeminiApiKey() {
  return claude.getRuntimeAnthropicApiKey()
}

export async function generateRegenerativeAdvice(opts) {
  const o = withPreferredLanguage(opts)
  return claude.generateRegenerativeAdvice(o)
}

export async function generateCompostRecipe(inventoryInput, opts) {
  const o = withPreferredLanguage(opts)
  return claude.generateCompostRecipe(inventoryInput, o)
}

export async function generateKnowledgeHub(opts) {
  const o = withPreferredLanguage(opts)
  return claude.generateKnowledgeHub(o)
}

export async function generateSmartAlert(opts) {
  const o = withPreferredLanguage(opts)
  return claude.generateSmartAlert(o)
}

export { buildSoilVitalityScoreFallback }

export async function generateSoilVitalityScore(opts) {
  const o = withPreferredLanguage(opts)
  return claude.generateSoilVitalityScore(o)
}

export async function generatePlantScan(opts) {
  const o = withPreferredLanguage(opts)
  return claude.generatePlantScan(o)
}

export async function generateDailyTasks(opts) {
  const o = withPreferredLanguage(opts)
  return claude.generateDailyTasks(o)
}

export async function generateLocationEnvironmentalAnalysis(opts) {
  const o = withPreferredLanguage(opts)
  return claude.generateLocationEnvironmentalAnalysis(o)
}

function normalizeFarmInsight(candidate, fallbackLocationUsed) {
  const c = candidate && typeof candidate === 'object' ? candidate : {}
  const recommendationsRaw = Array.isArray(c.recommendations) ? c.recommendations : []
  const recommendations = recommendationsRaw
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
    .slice(0, 6)

  const confidenceRaw = typeof c.confidence_level === 'string' ? c.confidence_level.toLowerCase() : ''
  const confidence_level =
    confidenceRaw === 'low' || confidenceRaw === 'medium' || confidenceRaw === 'high'
      ? confidenceRaw
      : 'medium'

  return {
    location_used:
      typeof c.location_used === 'string' && c.location_used.trim()
        ? c.location_used.trim()
        : fallbackLocationUsed || 'unknown',
    daily_summary:
      typeof c.daily_summary === 'string' && c.daily_summary.trim()
        ? c.daily_summary.trim()
        : 'Today looks stable overall; we reviewed your latest farm weather, soil status, and recent actions.',
    detected_changes:
      typeof c.detected_changes === 'string' && c.detected_changes.trim()
        ? c.detected_changes.trim()
        : 'No major shift detected yet; keep logging daily conditions so trend signals become stronger.',
    soil_health_status:
      typeof c.soil_health_status === 'string' && c.soil_health_status.trim()
        ? c.soil_health_status.trim()
        : 'Soil health is currently steady, with no immediate stress signals requiring emergency action.',
    recommendations: recommendations.length
      ? recommendations
      : [
          'Check topsoil moisture in the morning and adjust watering only if the top layer is drying.',
          'Keep mulch or residue cover in place to reduce evaporation and protect soil biology.',
          'Log any fertilizing, watering, or spraying done today so tomorrow recommendations are more precise.',
        ],
    confidence_level,
  }
}

export async function generateFarmDailyInsight(opts) {
  const resolved = withPreferredLanguage(opts)
  const locationUsed =
    typeof resolved?.locationContext?.locationUsed === 'string' ? resolved.locationContext.locationUsed : 'unknown'

  const primaryRaw = await claude.generateFarmDailyInsight(resolved)
  let primary = primaryRaw
  if (primaryRaw?.parseError && typeof primaryRaw?.rawText === 'string') {
    primary = extractJson(primaryRaw.rawText) || primaryRaw
  }
  return normalizeFarmInsight(primary, locationUsed)
}
