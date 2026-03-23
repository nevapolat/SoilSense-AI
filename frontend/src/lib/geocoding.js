function normalizeAddress(input) {
  return String(input || '').trim()
}

function simplifyAddress(input) {
  return String(input || '')
    .replace(/[^\p{L}\p{N}\s,.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function tryOpenMeteoLookup(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    query
  )}&count=5&language=en&format=json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Address lookup failed: HTTP ${res.status}`)
  const data = await res.json()
  const best = Array.isArray(data?.results) ? data.results[0] : null
  if (!best || typeof best.latitude !== 'number' || typeof best.longitude !== 'number') return null
  return {
    latitude: best.latitude,
    longitude: best.longitude,
    label: [best.name, best.admin1, best.country].filter(Boolean).join(', '),
  }
}

async function tryNominatimLookup(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
    query
  )}&limit=1`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.json()
  const best = Array.isArray(data) ? data[0] : null
  const latitude = Number(best?.lat)
  const longitude = Number(best?.lon)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return {
    latitude,
    longitude,
    label: String(best?.display_name || query),
  }
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
