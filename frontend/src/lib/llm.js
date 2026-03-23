import * as gemini from './geminiProvider.js'
import * as claude from './claudeProvider.js'
import { buildSoilVitalityScoreFallback } from './llmShared.js'
import { extractJson } from './llmJson.js'

/**
 * Which backend to use: `gemini` (Google) or `claude` (Anthropic).
 * Set `VITE_LLM_PROVIDER=claude` in frontend/.env and restart Vite.
 */
export function getLlmProvider() {
  const p = (import.meta.env.VITE_LLM_PROVIDER || 'gemini').toString().trim().toLowerCase()
  if (p === 'claude' || p === 'anthropic') return 'claude'
  return 'gemini'
}

function impl() {
  return getLlmProvider() === 'claude' ? claude : gemini
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
  return getLlmProvider() === 'claude'
    ? claude.getResolvedClaudeModelName()
    : gemini.getResolvedGeminiModelName()
}

export function setRuntimeGeminiApiKey(key) {
  if (getLlmProvider() === 'claude') return claude.setRuntimeAnthropicApiKey(key)
  return gemini.setRuntimeGeminiApiKey(key)
}

export function clearRuntimeGeminiApiKey() {
  if (getLlmProvider() === 'claude') return claude.clearRuntimeAnthropicApiKey()
  return gemini.clearRuntimeGeminiApiKey()
}

export function getRuntimeGeminiApiKey() {
  if (getLlmProvider() === 'claude') return claude.getRuntimeAnthropicApiKey()
  return gemini.getRuntimeGeminiApiKey()
}

export async function generateRegenerativeAdvice(opts) {
  return impl().generateRegenerativeAdvice(withPreferredLanguage(opts))
}

export async function generateCompostRecipe(inventoryInput, opts) {
  return impl().generateCompostRecipe(inventoryInput, withPreferredLanguage(opts))
}

export async function generateKnowledgeHub(opts) {
  return impl().generateKnowledgeHub(withPreferredLanguage(opts))
}

export async function generateSmartAlert(opts) {
  return impl().generateSmartAlert(withPreferredLanguage(opts))
}

export { buildSoilVitalityScoreFallback }

export async function generateSoilVitalityScore(opts) {
  return impl().generateSoilVitalityScore(withPreferredLanguage(opts))
}

export async function testGeminiApiKey(apiKey, opts) {
  if (getLlmProvider() === 'claude') return claude.testClaudeApiKey(apiKey, opts)
  return gemini.testGeminiApiKey(apiKey, opts)
}

export async function generatePlantScan(opts) {
  return impl().generatePlantScan(withPreferredLanguage(opts))
}

export async function generateDailyTasks(opts) {
  return impl().generateDailyTasks(withPreferredLanguage(opts))
}

export async function generateLocationEnvironmentalAnalysis(opts) {
  return impl().generateLocationEnvironmentalAnalysis(withPreferredLanguage(opts))
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

function uniqueRecommendations(primary = [], secondary = []) {
  const out = []
  const seen = new Set()
  for (const item of [...primary, ...secondary]) {
    const text = typeof item === 'string' ? item.trim() : ''
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
    if (out.length >= 6) break
  }
  return out
}

export async function generateFarmDailyInsight(opts) {
  const resolved = withPreferredLanguage(opts)
  const locationUsed =
    typeof resolved?.locationContext?.locationUsed === 'string' ? resolved.locationContext.locationUsed : 'unknown'

  const primaryProvider = getLlmProvider()
  const primaryImpl = primaryProvider === 'claude' ? claude : gemini
  const secondaryImpl = primaryProvider === 'claude' ? gemini : claude

  const primaryRaw = await primaryImpl.generateFarmDailyInsight(resolved)
  let primary = primaryRaw
  if (primaryRaw?.parseError && typeof primaryRaw?.rawText === 'string') {
    primary = extractJson(primaryRaw.rawText) || primaryRaw
  }
  const primaryNorm = normalizeFarmInsight(primary, locationUsed)

  try {
    const secondaryRaw = await secondaryImpl.generateFarmDailyInsight(resolved)
    let secondary = secondaryRaw
    if (secondaryRaw?.parseError && typeof secondaryRaw?.rawText === 'string') {
      secondary = extractJson(secondaryRaw.rawText) || secondaryRaw
    }
    const secondaryNorm = normalizeFarmInsight(secondary, locationUsed)

    return {
      ...primaryNorm,
      recommendations: uniqueRecommendations(primaryNorm.recommendations, secondaryNorm.recommendations),
      confidence_level:
        primaryNorm.confidence_level === secondaryNorm.confidence_level ? primaryNorm.confidence_level : 'medium',
      model_consensus:
        primaryNorm.soil_health_status.toLowerCase() === secondaryNorm.soil_health_status.toLowerCase()
          ? 'aligned'
          : 'partial',
    }
  } catch {
    return primaryNorm
  }
}

export function getGeminiModel(opts) {
  return gemini.getGeminiModel(opts)
}

export function getResolvedGeminiModelName() {
  return gemini.getResolvedGeminiModelName()
}
