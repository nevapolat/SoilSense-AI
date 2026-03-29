const FARM_MEMORY_PREFIX = 'soilsense.farmMemory.'

function cleanAddress(address) {
  return typeof address === 'string' ? address.trim() : ''
}

function safeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function resolveFarmLocationContext({ profile, coords } = {}) {
  const manualAddress = cleanAddress(profile?.address)
  const manualLat = safeNumber(profile?.latitude)
  const manualLon = safeNumber(profile?.longitude)
  const gpsLat = safeNumber(coords?.latitude)
  const gpsLon = safeNumber(coords?.longitude)

  if (manualAddress) {
    const locationUsed =
      manualLat != null && manualLon != null
        ? `manual:${manualAddress} (${manualLat.toFixed(5)}, ${manualLon.toFixed(5)})`
        : `manual:${manualAddress}`
    return {
      source: 'manual',
      locationUsed,
      latitude: manualLat ?? gpsLat,
      longitude: manualLon ?? gpsLon,
      address: manualAddress,
      farmKey: `manual:${manualAddress.toLowerCase()}`,
      isClear: true,
    }
  }

  if (gpsLat != null && gpsLon != null) {
    return {
      source: 'gps',
      locationUsed: `gps:${gpsLat.toFixed(5)},${gpsLon.toFixed(5)}`,
      latitude: gpsLat,
      longitude: gpsLon,
      address: '',
      farmKey: `gps:${gpsLat.toFixed(3)},${gpsLon.toFixed(3)}`,
      isClear: true,
    }
  }

  return {
    source: 'unknown',
    locationUsed: 'unknown',
    latitude: null,
    longitude: null,
    address: '',
    farmKey: '',
    isClear: false,
  }
}

export function loadFarmMemory(farmKey) {
  if (!farmKey) return null
  try {
    const raw = localStorage.getItem(`${FARM_MEMORY_PREFIX}${farmKey}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const entries = Array.isArray(parsed.entries) ? parsed.entries : []
    return { ...parsed, entries }
  } catch {
    return null
  }
}

export function appendFarmMemoryEntry(farmKey, locationContext, entry) {
  if (!farmKey || !entry || typeof entry !== 'object') return null
  const previous = loadFarmMemory(farmKey)
  const next = {
    farmKey,
    location: {
      source: locationContext?.source || 'unknown',
      locationUsed: locationContext?.locationUsed || 'unknown',
      address: locationContext?.address || '',
      latitude: safeNumber(locationContext?.latitude),
      longitude: safeNumber(locationContext?.longitude),
      updatedAt: new Date().toISOString(),
    },
    entries: [...(previous?.entries || []), entry],
  }
  try {
    localStorage.setItem(`${FARM_MEMORY_PREFIX}${farmKey}`, JSON.stringify(next))
  } catch {
    // best effort
  }
  return next
}

export function buildDetectedChangesFromMemory(farmMemory) {
  const entries = Array.isArray(farmMemory?.entries) ? farmMemory.entries : []
  if (entries.length < 2) return 'Baseline recorded; trend detection will strengthen with more daily entries.'
  const latest = entries[entries.length - 1] || {}
  const prev = entries[entries.length - 2] || {}

  const changes = []
  const latestTemp = safeNumber(latest?.weather?.tempNowC)
  const prevTemp = safeNumber(prev?.weather?.tempNowC)
  if (latestTemp != null && prevTemp != null) {
    const delta = latestTemp - prevTemp
    if (Math.abs(delta) >= 2) changes.push(`temperature ${delta > 0 ? 'increased' : 'decreased'} by ${Math.abs(delta).toFixed(1)}C`)
  }

  const latestRain = safeNumber(latest?.weather?.precipitationSumMm)
  const prevRain = safeNumber(prev?.weather?.precipitationSumMm)
  if (latestRain != null && prevRain != null) {
    const delta = latestRain - prevRain
    if (Math.abs(delta) >= 3) changes.push(`rainfall ${delta > 0 ? 'increased' : 'decreased'} by ${Math.abs(delta).toFixed(1)}mm`)
  }

  const latestHumidity = safeNumber(latest?.weather?.humidityNowPct)
  const prevHumidity = safeNumber(prev?.weather?.humidityNowPct)
  if (latestHumidity != null && prevHumidity != null) {
    const delta = latestHumidity - prevHumidity
    if (Math.abs(delta) >= 8)
      changes.push(`humidity ${delta > 0 ? 'increased' : 'decreased'} by ${Math.abs(delta).toFixed(0)}%`)
  }

  if (!changes.length) return 'No major weather shift since the previous entry; conditions are relatively stable.'
  return `Detected changes: ${changes.join('; ')}.`
}
