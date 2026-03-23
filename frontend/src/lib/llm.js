import * as gemini from './geminiProvider.js'
import * as claude from './claudeProvider.js'
import { buildSoilVitalityScoreFallback } from './llmShared.js'

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

export function getGeminiModel(opts) {
  return gemini.getGeminiModel(opts)
}

export function getResolvedGeminiModelName() {
  return gemini.getResolvedGeminiModelName()
}
