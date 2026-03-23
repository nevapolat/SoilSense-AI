function normalizeAddress(input) {
  return String(input || '').trim()
}

function simplifyAddress(input) {
  return String(input || '')
    .replace(/[^\p{L}\p{N}\s,.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s,.-]/gu, ' ')
    .split(/[\s,.-]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2)
}

function scoreCandidate(queryTokens, label, focusFields = []) {
  const lowerLabel = String(label || '').toLowerCase()
  const focus = focusFields.map((x) => String(x || '').toLowerCase()).join(' ')
  let score = 0

  for (const token of queryTokens) {
    if (focus.includes(token)) score += 6
    else if (lowerLabel.includes(token)) score += 3
  }

  // Reward strong city-level exact matches.
  if (queryTokens.some((t) => focus === t || focus.startsWith(`${t} `) || focus.endsWith(` ${t}`))) score += 8
  return score
}

function pickBestCandidate(query, candidates) {
  const queryTokens = tokenize(query)
  if (!queryTokens.length) return candidates[0] || null
  let best = null
  let bestScore = -1
  for (const c of candidates) {
    const score = scoreCandidate(queryTokens, c.label, c.focusFields)
    if (score > bestScore) {
      best = c
      bestScore = score
    }
  }
  return best
}

async function tryOpenMeteoLookup(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    query
  )}&count=10&language=en&format=json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Address lookup failed: HTTP ${res.status}`)
  const data = await res.json()
  const results = Array.isArray(data?.results) ? data.results : []
  const candidates = results
    .filter((best) => typeof best?.latitude === 'number' && typeof best?.longitude === 'number')
    .map((best) => ({
      latitude: best.latitude,
      longitude: best.longitude,
      label: [best.name, best.admin1, best.country].filter(Boolean).join(', '),
      focusFields: [best.name, best.admin1, best.admin2, best.country],
    }))
  const best = pickBestCandidate(query, candidates)
  return best || null
}

async function tryNominatimLookup(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
    query
  )}&limit=8&addressdetails=1`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.json()
  const rows = Array.isArray(data) ? data : []
  const candidates = rows
    .map((best) => {
      const latitude = Number(best?.lat)
      const longitude = Number(best?.lon)
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
      const addr = best?.address && typeof best.address === 'object' ? best.address : {}
      return {
        latitude,
        longitude,
        label: String(best?.display_name || query),
        focusFields: [
          addr.city,
          addr.town,
          addr.village,
          addr.county,
          addr.state,
          addr.country,
          best?.name,
        ],
      }
    })
    .filter(Boolean)
  const best = pickBestCandidate(query, candidates)
  return best || null
}

export async function geocodeFieldAddress(address) {
  const q = normalizeAddress(address)
  if (!q) throw new Error('Address is required.')
  const attempts = [q, simplifyAddress(q)].filter(Boolean)
  for (const attempt of attempts) {
    try {
      const openMeteo = await tryOpenMeteoLookup(attempt)
      if (openMeteo) return openMeteo
    } catch {
      // try fallback provider below
    }
    const nominatim = await tryNominatimLookup(attempt)
    if (nominatim) return nominatim
  }
  throw new Error(
    'Address lookup was inconclusive. Keep this address saved and continue; AI regional analysis will still run, then refine with city/district/country for weather-accurate alerts.'
  )
}
