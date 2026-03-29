import { getLanguageDisplayName } from '../i18n/languages'

export const REG_AGRI_EXPERT_PERSONA = `You are a Regenerative Agriculture Expert.
Your guidance must focus on soil health and increasing organic carbon.
Give practical, actionable advice that a farmer can use.
If specific details are missing, make reasonable regenerative best-practice assumptions and clearly say so.`

export function buildLanguageInstruction(lang) {
  const languageName = getLanguageDisplayName(lang)
  return languageName
    ? `You MUST respond only in ${languageName}. Do not mix languages, do not default to English, and do not transliterate unless explicitly requested.`
    : ''
}

/** Extra constraint for JSON daily-tasks payloads so visible strings match the UI locale. */
export function buildJsonTaskLanguageConstraint(lang) {
  const languageName = getLanguageDisplayName(lang)
  return languageName
    ? `JSON language rule: every string in tasks[].title, tasks[].whyThisTaskHelps, and each tasks[].steps[] entry MUST be written in ${languageName}. Do not leave these user-facing strings in English unless the target language is English.`
    : ''
}

export function formatCoords(latitude, longitude) {
  if (latitude == null || longitude == null) return 'Location not provided.'
  const lat = Number(latitude).toFixed(5)
  const lon = Number(longitude).toFixed(5)
  return `Coordinates: lat ${lat}, lon ${lon}.`
}

export function normalizeInventory(items) {
  const list = Array.isArray(items) ? items : []
  const cleaned = list
    .map((x) => String(x).trim())
    .filter(Boolean)
    .map((x) => x.replace(/\s+/g, ' '))

  const seen = new Set()
  const result = []
  for (const item of cleaned) {
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

export function buildSoilVitalityScoreFallback(signals, lang) {
  const tNow = signals?.tempNowC
  const hNow = signals?.humidityNowPct
  const precipSumMm = signals?.precipitationSumMm

  const temp = typeof tNow === 'number' ? tNow : null
  const humidity = typeof hNow === 'number' ? hNow : null
  const precipSum = typeof precipSumMm === 'number' ? precipSumMm : null

  const l = (lang || 'en').toLowerCase()
  const explanationByLang = {
    en: {
      noSignals:
        'Score is moderate; enable location for more accurate local conditions.',
      moderate: 'Score is moderate; maintain soil cover and organic inputs.',
      high: 'Score is high due to recent rainfall and optimal temperature for microbial activity.',
      strong:
        'Score is strong due to favorable moisture and temperature conditions for soil microbes.',
      lower:
        'Score is lower because moisture is limited—mulch and water deeply and less often.',
    },
    tr: {
      noSignals:
        'Puan orta; daha dogru yerel kosullar icin konumu etkinlestirin.',
      moderate:
        'Puan orta; toprak örtüsünü ve organik girdileri koruyun.',
      high: 'Puan yuksek; yakin zamanda yagmur yagdi ve mikrop aktivitesi icin sicaklik ideal.',
      strong: 'Puan yuksek; nem ve sicaklik kosullari toprak mikroorganizmalarina uygun.',
      lower: 'Puan daha dusuk; nem kisitli. Topragi ortun ve daha seyrek, derin sulayin.',
    },
    de: {
      noSignals:
        'Der Wert ist moderat; aktiviere den Standort für genauere lokale Bedingungen.',
      moderate: 'Wert moderat; halte Bodenbedeckung und organische Inputs aufrecht.',
      high: 'Der Wert ist hoch wegen des jüngsten Regens und optimaler Temperaturen für die Mikrobentätigkeit.',
      strong: 'Der Wert ist stark wegen günstiger Feuchte- und Temperaturbedingungen für Bodenmikroben.',
      lower: 'Der Wert ist niedriger, weil Feuchtigkeit begrenzt ist - mulchen und seltener, dafür tief gießen.',
    },
    es: {
      noSignals:
        'La puntuacion es moderada; activa la ubicacion para condiciones locales mas precisas.',
      moderate:
        'Puntuacion moderada; mantén cobertura del suelo y aportes organicos.',
      high: 'La puntuacion es alta por la lluvia reciente y una temperatura adecuada para la actividad microbiana.',
      strong:
        'La puntuacion es fuerte por condiciones favorables de humedad y temperatura para los microbios del suelo.',
      lower:
        'La puntuacion es mas baja porque la humedad es limitada: usa acolchado y riega profundo pero menos seguido.',
    },
    zh: {
      noSignals: '评分为中等；请启用位置以获得更准确的本地条件。',
      moderate: '评分中等；保持土壤覆盖和有机投入。',
      high: '由于近期降雨和微生物活动的适宜温度，评分较高。',
      strong: '由于土壤微生物所需的湿度和温度条件较好，评分较高。',
      lower: '评分较低是因为水分有限；覆盖保湿并少量深层浇水。',
    },
  }
  const exp = explanationByLang[l] || explanationByLang.en

  if (temp == null || humidity == null || precipSum == null) {
    return { soilHealthScore: 55, explanation: exp.noSignals }
  }

  const tempCenter = 22
  const tempFactor = Math.max(0, 1 - Math.abs(temp - tempCenter) / 16)
  const humidityFactor = Math.max(0, Math.min(1, humidity / 100))
  const precipFactor = Math.max(0, Math.min(1, precipSum / 12))

  const score = Math.max(
    0,
    Math.min(100, Math.round(30 * tempFactor + 35 * humidityFactor + 35 * precipFactor))
  )

  let explanation = exp.moderate
  const hasRain = precipSum >= 6
  const optimalTemp = temp >= 18 && temp <= 26

  if (score >= 80 && hasRain && optimalTemp) {
    explanation = exp.high
  } else if (score >= 70 && (hasRain || optimalTemp)) {
    explanation = exp.strong
  } else if (score <= 45 && (humidity < 45 || precipSum < 3)) {
    explanation = exp.lower
  }

  return { soilHealthScore: score, explanation }
}

function pickWeatherSignalsForKnowledgeHub(signals) {
  if (!signals || typeof signals !== 'object') return null
  const s = signals
  const out = {}
  if (typeof s.tempNowC === 'number' && Number.isFinite(s.tempNowC)) out.tempNowC = s.tempNowC
  if (typeof s.humidityNowPct === 'number' && Number.isFinite(s.humidityNowPct)) out.humidityNowPct = s.humidityNowPct
  if (typeof s.precipitationSumMm === 'number' && Number.isFinite(s.precipitationSumMm)) out.precipitationSumMm = s.precipitationSumMm
  if (typeof s.next48hMinTempC === 'number' && Number.isFinite(s.next48hMinTempC)) out.next48hMinTempC = s.next48hMinTempC
  if (typeof s.firstBelow2CInHours === 'number' && Number.isFinite(s.firstBelow2CInHours)) {
    out.firstBelow2CInHours = s.firstBelow2CInHours
  }
  if (typeof s.humidityBucket === 'string') out.humidityBucket = s.humidityBucket
  if (typeof s.sunBucket === 'string') out.sunBucket = s.sunBucket
  return Object.keys(out).length ? out : null
}

/**
 * Structured, non-secret context for Knowledge Hub personalization (Guide tab).
 */
export function buildKnowledgeHubContextPayload({
  profile,
  coords,
  activityImpact,
  weatherSignals,
  climateZoneHint,
  locationIntel,
} = {}) {
  const equipment = profile?.equipment || {}
  const customEq = Array.isArray(equipment.custom) ? equipment.custom : []
  const currentCrops = Array.isArray(profile?.currentCrops) ? profile.currentCrops : []
  const customCrops = Array.isArray(profile?.customCrops) ? profile.customCrops : []

  let intel = null
  if (locationIntel && typeof locationIntel === 'object' && !locationIntel.parseError) {
    const regional =
      typeof locationIntel.regionalSummary === 'string' ? locationIntel.regionalSummary.trim().slice(0, 500) : ''
    const gsc = Array.isArray(locationIntel.generalSoilCharacteristics)
      ? locationIntel.generalSoilCharacteristics.map((x) => String(x).trim()).filter(Boolean).slice(0, 5)
      : []
    const cs = Array.isArray(locationIntel.cropSuitability)
      ? locationIntel.cropSuitability.map((x) => String(x).trim()).filter(Boolean).slice(0, 10)
      : []
    intel = {
      climateZone: typeof locationIntel.climateZone === 'string' ? locationIntel.climateZone.trim() : null,
      regionalSummary: regional || null,
      generalSoilCharacteristics: gsc.length ? gsc : null,
      cropSuitability: cs.length ? cs : null,
    }
    if (!intel.climateZone && !intel.regionalSummary && !intel.generalSoilCharacteristics && !intel.cropSuitability) {
      intel = null
    }
  }

  return {
    farmProfile: {
      soilType: typeof profile?.soilType === 'string' ? profile.soilType : 'unknown',
      address: typeof profile?.address === 'string' ? profile.address.trim().slice(0, 220) : '',
      fieldSize:
        typeof profile?.fieldSize?.value === 'number' && Number.isFinite(profile.fieldSize.value)
          ? { value: profile.fieldSize.value, unit: profile.fieldSize.unit === 'sqm' ? 'sqm' : 'ha' }
          : null,
      workforce: typeof profile?.workforce === 'number' && Number.isFinite(profile.workforce) ? profile.workforce : null,
      equipment: {
        shovel: Boolean(equipment.shovel),
        tractor: Boolean(equipment.tractor),
        sprinkler: Boolean(equipment.sprinkler),
        dripIrrigation: Boolean(equipment.dripIrrigation),
        custom: customEq.slice(0, 16).map((x) => String(x).trim()).filter(Boolean),
      },
      crops: [...currentCrops.map(String), ...customCrops.map(String)].filter(Boolean).slice(0, 28),
    },
    location: {
      coordinates:
        coords && typeof coords.latitude === 'number' && typeof coords.longitude === 'number'
          ? { latitude: coords.latitude, longitude: coords.longitude }
          : null,
      climateZoneHint: typeof climateZoneHint === 'string' && climateZoneHint.trim() ? climateZoneHint.trim() : null,
      environmentalIntel: intel,
    },
    recentActivitySummary: activityImpact
      ? {
          organicMatterKgApprox:
            typeof activityImpact.organicKg === 'number' && Number.isFinite(activityImpact.organicKg)
              ? Math.round(activityImpact.organicKg * 10) / 10
              : 0,
          chemicalPesticideLitersApprox:
            typeof activityImpact.chemicalPesticideLiters === 'number' &&
            Number.isFinite(activityImpact.chemicalPesticideLiters)
              ? Math.round(activityImpact.chemicalPesticideLiters * 100) / 100
              : 0,
          chemicalFertilizerKgApprox:
            typeof activityImpact.chemicalFertilizerKg === 'number' && Number.isFinite(activityImpact.chemicalFertilizerKg)
              ? Math.round(activityImpact.chemicalFertilizerKg * 10) / 10
              : 0,
          compostRecentlyAdded: Boolean(activityImpact.compostRecentlyAdded),
          chemicalRecentlyApplied: Boolean(activityImpact.chemicalRecentlyApplied),
        }
      : null,
    weatherSignalsToday: pickWeatherSignalsForKnowledgeHub(weatherSignals),
  }
}
