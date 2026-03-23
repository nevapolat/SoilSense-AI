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
