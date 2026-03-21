import { GoogleGenerativeAI } from '@google/generative-ai'
import { getLanguageDisplayName } from '../i18n/languages'

// Use an ID that exists for your current API key (verified via REST model list).
const DEFAULT_MODEL = 'gemini-flash-latest'

const RUNTIME_API_KEY_STORAGE = 'soilsense.runtimeGeminiApiKey'

let runtimeGeminiApiKey = null

function getRuntimeApiKey() {
  if (runtimeGeminiApiKey) return runtimeGeminiApiKey
  try {
    runtimeGeminiApiKey = localStorage.getItem(RUNTIME_API_KEY_STORAGE)
  } catch {
    // ignore (localStorage may be unavailable)
  }
  return runtimeGeminiApiKey
}

export function setRuntimeGeminiApiKey(apiKey) {
  const cleaned = apiKey ? String(apiKey).trim() : ''
  runtimeGeminiApiKey = cleaned || null
  try {
    if (runtimeGeminiApiKey) {
      localStorage.setItem(RUNTIME_API_KEY_STORAGE, runtimeGeminiApiKey)
    } else {
      localStorage.removeItem(RUNTIME_API_KEY_STORAGE)
    }
  } catch {
    // ignore
  }
}

export function clearRuntimeGeminiApiKey() {
  setRuntimeGeminiApiKey('')
}

export function getRuntimeGeminiApiKey() {
  return getRuntimeApiKey() || ''
}

const REG_AGRI_EXPERT_PERSONA = `You are a Regenerative Agriculture Expert.
Your guidance must focus on soil health and increasing organic carbon.
Give practical, actionable advice that a farmer can use.
If specific details are missing, make reasonable regenerative best-practice assumptions and clearly say so.`

function buildLanguageInstruction(lang) {
  const languageName = getLanguageDisplayName(lang)
  return languageName ? `Respond in ${languageName}.` : ''
}

function formatCoords(latitude, longitude) {
  if (latitude == null || longitude == null) return 'Location not provided.'
  const lat = Number(latitude).toFixed(5)
  const lon = Number(longitude).toFixed(5)
  return `Coordinates: lat ${lat}, lon ${lon}.`
}

function requireApiKey(apiKeyOverride) {
  const envKey = import.meta.env.VITE_GEMINI_API_KEY
  const apiKey = apiKeyOverride ?? getRuntimeApiKey() ?? envKey
  if (!apiKey) {
    throw new Error(
      'Missing VITE_GEMINI_API_KEY. Check your frontend/.env file and restart the dev server.'
    )
  }

  return apiKey
}

export function getGeminiModel({ apiKeyOverride } = {}) {
  const apiKey = requireApiKey(apiKeyOverride)
  const modelName =
    import.meta.env.VITE_GEMINI_MODEL?.toString() || DEFAULT_MODEL

  const genAI = new GoogleGenerativeAI(apiKey)
  return genAI.getGenerativeModel({ model: modelName })
}

// Minimal helper to verify the AI connection works end-to-end.
async function generateGeminiText(prompt, { apiKeyOverride } = {}) {
  const model = getGeminiModel({ apiKeyOverride })
  try {
    const result = await model.generateContent(prompt)
    return result.response.text()
  } catch (err) {
    const msg = err?.message ? err.message : String(err)
    const name = err?.name ? String(err.name) : ''
    const combined = `${name} ${msg}`.toLowerCase()

    // Explicit Safety/Security handling for clearer UX.
    if (combined.includes('safety') || combined.includes('safetyexception')) {
      throw new Error(
        'Gemini request blocked by Safety. Please try a different prompt or simplify the content.'
      )
    }
    if (combined.includes('security') || combined.includes('securityexception')) {
      throw new Error(
        'Gemini request blocked by Security policy. Please try again or use a different API key if this persists.'
      )
    }

    if (
      /leaked/i.test(msg) ||
      /forbidden/i.test(msg) ||
      /403/i.test(msg) ||
      /expired/i.test(msg) ||
      /API key expired/i.test(msg) ||
      /API_KEY_INVALID/i.test(msg) ||
      /API_KEY_INVALID/i.test(msg)
    ) {
      throw new Error(
        'Gemini API key is not usable (blocked/expired/invalid). Please renew or create a fresh API key, update `VITE_GEMINI_API_KEY`, then reload the app (or use the Dashboard testing key panel).'
      )
    }
    throw err
  }
}

// Main AI entry point for SoilSense.
export async function generateRegenerativeAdvice({ latitude, longitude, lang } = {}) {
  const locationLine = formatCoords(latitude, longitude)
  const prompt = `${REG_AGRI_EXPERT_PERSONA}

${buildLanguageInstruction(lang)}

User request:
Provide next-step advice to improve soil health and increase organic carbon.
Be specific about regenerative practices (e.g., cover crops, compost, reduced tillage, mulching, grazing management, soil testing cadence).

${locationLine}

Return plain text (no markdown), with these sections:
1) Soil health snapshot
2) Organic carbon building plan (5 bullet points)
3) What to measure (soil indicators to track)
4) 30-day starter actions

Keep it concise and actionable.`

  return generateGeminiText(prompt)
}

function extractJson(text) {
  if (!text) return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null

  const candidate = text.slice(start, end + 1)
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

function normalizeInventory(items) {
  const list = Array.isArray(items) ? items : []
  const cleaned = list
    .map((x) => String(x).trim())
    .filter(Boolean)
    .map((x) => x.replace(/\s+/g, ' '))

  // De-duplicate (case-insensitive)
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

// Task 5: Compost wizard recipe generation.
export async function generateCompostRecipe(inventoryInput, { lang } = {}) {
  const inventory = normalizeInventory(inventoryInput)
  const inventoryList = inventory.length
    ? inventory.map((x) => `- ${x}`).join('\n')
    : '- (none provided)'

  const prompt = `${REG_AGRI_EXPERT_PERSONA}

${buildLanguageInstruction(lang)}

You are designing a compost recipe using the user's waste inventory.

Waste Inventory:
${inventoryList}

Compost Logic Requirements:
1) Classify each waste item as GREEN (nitrogen-rich) or BROWN (carbon-rich) using common composting guidance.
2) Compute a simple green vs brown balance (approximate by "greenPercent" and "brownPercent" that sum to 100).
3) Choose an appropriate difficulty level based on whether the inputs are well-balanced and easy to layer.
4) Choose an estimated maturity time in months (as a number). If inputs are very carbon-heavy or very nitrogen-heavy, use a longer estimate.
5) Provide step-by-step layering instructions tailored to exactly the listed items.

Return ONLY strict JSON (no markdown, no commentary) with this schema:
{
  "difficultyLevel": "Easy" | "Medium" | "Hard",
  "estimatedMaturityTimeMonths": number,
  "greenBrownBalance": {
    "greenPercent": number,
    "brownPercent": number,
    "greenItems": string[],
    "brownItems": string[]
  },
  "layeringSteps": string[],
  "proTip": string
}

Formatting rules:
- "layeringSteps" should be 5 to 10 short steps, each a single string.`

  const text = await generateGeminiText(prompt)
  const json = extractJson(text)
  if (json) return json

  return { parseError: true, rawText: text }
}

// Task 6: Knowledge Hub (permanent categories).
export async function generateKnowledgeHub({ lang } = {}) {
  const prompt = `You are a Regenerative Agriculture Expert.
${buildLanguageInstruction(lang)}
Create a permanent Knowledge Hub with exactly these 3 categories:
1) Soil Restoration
2) Water Conservation
3) Biodiversity

For each category:
- Provide a short 1-2 sentence summary.
- Provide 4-7 permanent bullet points that farmers can apply and revisit.

Return ONLY strict JSON (no markdown, no commentary) with this schema:
{
  "categories": [
    {
      "name": "Soil Restoration",
      "summary": string,
      "bullets": string[]
    },
    {
      "name": "Water Conservation",
      "summary": string,
      "bullets": string[]
    },
    {
      "name": "Biodiversity",
      "summary": string,
      "bullets": string[]
    }
  ]
}

Notes:
- Bullets should be timeless (not date-specific).
- Keep bullets concise and action-oriented.`

  const text = await generateGeminiText(prompt)
  const json = extractJson(text)
  if (json) return json
  return { parseError: true, rawText: text }
}

// Task 6: Smart Alert (weather-driven warning).
export async function generateSmartAlert({
  latitude,
  longitude,
  weatherSummary,
  next48hHourly,
  lang,
} = {}) {
  const locationLine = formatCoords(latitude, longitude)

  const prompt = `You are a Regenerative Agriculture Expert and Frost/Risk Alert Specialist.
Using the provided location and weather forecast data, generate a single, decisive Smart Alert for today.
${buildLanguageInstruction(lang)}

Location:
${locationLine}

Weather signals (structured JSON for today/current):
${JSON.stringify(weatherSummary)}

Next 48 hours hourly forecast (structured JSON):
${JSON.stringify(next48hHourly)}

Critical rule for frost detection:
- Look specifically for temperatures dropping below 2.0°C (35.6°F) at any hour within the next 48 hours.
- If frost risk is detected, you MUST identify the earliest hour when temperature_2m is below 2.0°C, and compute how many hours from "now" that happens (rounded to nearest whole hour, minimum 0).
- If frost risk is NOT detected, choose the most relevant non-frost soil risk from the data (heat/evaporation, heavy rain, wind stress).

Severity guidance:
- More severe frost when temperature drops further below 2.0°C and/or dew point is very low (risk to sensitive plants is higher).

Return ONLY strict JSON (no markdown, no commentary) with this schema:
{
  "riskType": string,
  "isCritical": boolean,
  "headline": string,
  "recommendedAction": string,
  "actionPlan": string,
  "details": string,
  "tags": string[]
}

Formatting rules:
- If isCritical is true (frost detected), "headline" MUST be exactly one sentence and MUST start with:
  "CRITICAL: Frost expected in X hours. Cover your sensitive plants!"
- "recommendedAction" must be practical and regenerative (1-2 sentences).
- "actionPlan" must be specific and time-sensitive (2-3 short steps in text, not a bullet list).`

  const combined = { weatherSummary, next48hHourly }
  const text = await generateGeminiText(prompt + `\n\n(For reference, JSON blob):\n${JSON.stringify(combined)}`)
  const json = extractJson(text)
  if (json) return json
  return { parseError: true, rawText: text }
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

  // Simple heuristic: best soil microbial activity tends to occur around 18–26C,
  // with higher humidity and meaningful recent precipitation.
  const tempCenter = 22
  const tempFactor = Math.max(0, 1 - Math.abs(temp - tempCenter) / 16) // 0..1
  const humidityFactor = Math.max(0, Math.min(1, humidity / 100)) // 0..1

  // Convert precipitation sum into a 0..1 factor.
  const precipFactor = Math.max(0, Math.min(1, precipSum / 12)) // ~12mm => 1

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

export async function generateSoilVitalityScore({ weatherSummary, lang } = {}) {
  const prompt = `You are a Regenerative Agriculture Expert.
${buildLanguageInstruction(lang)}
Calculate a "Soil Health Score" from 0 to 100 using the provided weather signals to estimate microbial vitality and organic carbon building conditions.

Weather signals (structured JSON):
${JSON.stringify(weatherSummary)}

Scoring rules (guidance):
- Higher score when temperature is in a microbial-friendly range (~18–26C), humidity is high, and precipitation indicates recent moisture.
- Lower score during heat stress, very low humidity, or very dry conditions (low recent precipitation).

Return ONLY strict JSON (no markdown, no commentary) with schema:
{
  "soilHealthScore": number, 
  "explanation": string
}

Explanation should be 1 sentence, card-friendly, and suitable for a farmer (e.g., "Score is high due to recent rainfall and optimal temperature.").`

  const text = await generateGeminiText(prompt)
  const json = extractJson(text)
  if (json) return json

  return { parseError: true, rawText: text }
}

// For the UI to verify a runtime-pasted key works.
export async function testGeminiApiKey(apiKey) {
  const text = await generateGeminiText('Return exactly: OK', {
    apiKeyOverride: apiKey,
  })
  return String(text).trim()
}

function getGeminiModelByName(modelName, apiKeyOverride) {
  const apiKey = requireApiKey(apiKeyOverride)
  const genAI = new GoogleGenerativeAI(apiKey)
  return genAI.getGenerativeModel({ model: modelName })
}

// Task 8: AI Plant Scanner (Vision).
export async function generatePlantScan({
  imageBase64,
  mimeType,
  prompt,
  lang,
} = {}) {
  const plantScanPrompt =
    prompt ||
    `You are an AI Plant Doctor (plant pathology and agronomy expert).
Perform a deep medical audit of the plant photo.
Use careful reasoning but stay grounded in what is visible in the image.

You MUST return strict JSON that matches the schema exactly.

Important:
- healthStatus must be exactly one of: "Healthy" | "Stressed" | "Sick" (use these English tokens exactly).
- All other string fields must be written in the user's language.

${buildLanguageInstruction(lang)}

Return ONLY strict JSON (no markdown, no commentary) with this schema:
{
  "plantName": string,
  "healthStatus": "Healthy" | "Stressed" | "Sick",
  "diseaseName": string | null,
  "symptomsVisible": string[],
  "treatmentPlan": string[]
}

Rules:
- symptomsVisible must be 3-8 short phrases describing what is visible
- treatmentPlan must be 4-8 concrete steps (doctor prescription style)
- If no specific disease is identifiable from the image, set diseaseName to null`

  const inlineData = { mimeType, data: imageBase64 }

  const modelsToTry = ['gemini-1.5-flash', DEFAULT_MODEL]
  let lastErr = null

  for (const modelName of modelsToTry) {
    try {
      const model = getGeminiModelByName(modelName, null)
      const result = await model.generateContent([
        {
          role: 'user',
          parts: [{ text: plantScanPrompt }, { inlineData }],
        },
      ])

      const text = result?.response?.text?.() ?? ''
      const json = extractJson(text)
      if (json) return json
      return { parseError: true, rawText: text }
    } catch (err) {
      lastErr = err
    }
  }

  const msg = lastErr?.message ? lastErr.message : String(lastErr)
  return { parseError: true, rawText: msg }
}

// Task 9: Daily Task Engine.
export async function generateDailyTasks({ weatherSummary, soilHealthScore, lang } = {}) {
  const prompt = `You are a Regenerative Agriculture Expert.
${buildLanguageInstruction(lang)}
Create exactly 3 actionable daily tasks for a farmer based on:
1) today's weather signals (structured JSON)
2) the Soil Health Score (0-100)

Weather signals (structured JSON):
${JSON.stringify(weatherSummary)}

Soil Health Score:
${soilHealthScore}

Return ONLY strict JSON (no markdown, no commentary) with this schema:
{
  "tasks": [
    {
      "id": string,
      "title": string,
      "whyThisTaskHelps": string,
      "steps": string[],
      "estimatedMinutes": number
    }
  ]
}

Rules:
- tasks array length must be 3
- steps array length must be 3-6
- estimatedMinutes between 5 and 45`

  const text = await generateGeminiText(prompt)
  const json = extractJson(text)
  if (json) return json
  return { parseError: true, rawText: text }
}

