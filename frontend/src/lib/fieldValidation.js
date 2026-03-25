/** Minimum area ~1 m² (0.0001 ha). Maximum ~500k ha — catches typos while allowing very large farms. */
export const FIELD_AREA_HA_MIN = 1e-4
export const FIELD_AREA_HA_MAX = 500_000

export function fieldAreaHectares(value, unit) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  const u = unit === 'sqm' ? 'sqm' : 'ha'
  return u === 'sqm' ? value / 10000 : value
}

export function isRealisticFieldAreaHa(ha) {
  if (typeof ha !== 'number' || !Number.isFinite(ha)) return false
  return ha >= FIELD_AREA_HA_MIN && ha <= FIELD_AREA_HA_MAX
}

/**
 * Parse a positive field size: digits with optional single decimal separator (. or ,).
 * Rejects empty, negative, scientific notation, and non-numeric text.
 */
export function parseStrictPositiveFieldSize(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return { ok: false, code: 'empty' }
  const normalized = s.replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(normalized)) return { ok: false, code: 'notNumeric' }
  const value = Number(normalized)
  if (!Number.isFinite(value) || value <= 0) return { ok: false, code: 'notNumeric' }
  return { ok: true, value }
}
