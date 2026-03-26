/**
 * Lightweight token usage estimation (no tokenizer dependency).
 *
 * Notes:
 * - This is an approximation meant for cost debugging, not billing-accurate accounting.
 * - For many LLMs, a rough rule of thumb is ~4 chars/token for English-like text.
 * - JSON / code tends to be slightly more token-dense; we conservatively use ~3.6 chars/token.
 */

function clampInt(n, min, max) {
  const x = Math.round(Number(n) || 0)
  if (!Number.isFinite(x)) return min
  return Math.max(min, Math.min(max, x))
}

function looksLikeJsonOrCode(s) {
  const t = String(s || '').trim()
  if (!t) return false
  if (t.startsWith('{') || t.startsWith('[')) return true
  if (t.includes('":') || t.includes('{\n') || t.includes('}\n')) return true
  if (t.includes('function ') || t.includes('const ') || t.includes('import ')) return true
  if (t.includes('```')) return true
  return false
}

export function estimateTextTokens(text) {
  const s = String(text || '')
  if (!s) return 0
  const charsPerToken = looksLikeJsonOrCode(s) ? 3.6 : 4.0
  // Add a small overhead for message framing / system glue.
  const estimated = s.length / charsPerToken + 6
  return clampInt(estimated, 0, 10_000_000)
}

/**
 * Estimates tokens implied by base64 image payload size.
 * This is not "real tokens" for vision models, but helps spot huge uploads.
 */
export function estimateBase64PayloadTokens(base64) {
  const b64 = typeof base64 === 'string' ? base64 : ''
  if (!b64) return 0
  // base64 expands bytes by ~4/3; reverse that to estimate bytes.
  const approxBytes = Math.round((b64.length * 3) / 4)
  // Treat ~4 bytes as "one token equivalent" for rough debugging.
  const estimated = approxBytes / 4
  return clampInt(estimated, 0, 10_000_000)
}

