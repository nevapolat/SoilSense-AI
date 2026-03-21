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
  return impl().generateRegenerativeAdvice(opts)
}

export async function generateCompostRecipe(inventoryInput, opts) {
  return impl().generateCompostRecipe(inventoryInput, opts)
}

export async function generateKnowledgeHub(opts) {
  return impl().generateKnowledgeHub(opts)
}

export async function generateSmartAlert(opts) {
  return impl().generateSmartAlert(opts)
}

export { buildSoilVitalityScoreFallback }

export async function generateSoilVitalityScore(opts) {
  return impl().generateSoilVitalityScore(opts)
}

export async function testGeminiApiKey(apiKey, opts) {
  if (getLlmProvider() === 'claude') return claude.testClaudeApiKey(apiKey, opts)
  return gemini.testGeminiApiKey(apiKey, opts)
}

export async function generatePlantScan(opts) {
  return impl().generatePlantScan(opts)
}

export async function generateDailyTasks(opts) {
  return impl().generateDailyTasks(opts)
}

export function getGeminiModel(opts) {
  return gemini.getGeminiModel(opts)
}

export function getResolvedGeminiModelName() {
  return gemini.getResolvedGeminiModelName()
}
