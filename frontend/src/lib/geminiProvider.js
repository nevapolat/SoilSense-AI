import { GoogleGenerativeAI } from '@google/generative-ai'
import { createLogger, normalizeErrorForLog } from './logger'
import { extractJson } from './llmJson.js'
import {
  REG_AGRI_EXPERT_PERSONA,
  buildLanguageInstruction,
  formatCoords,
  normalizeInventory,
} from './llmShared.js'

// Use an ID that exists for your current API key (verified via REST model list).
const DEFAULT_MODEL = 'gemini-flash-latest'

const geminiLog = createLogger('gemini')

export function getResolvedGeminiModelName() {
  return import.meta.env.VITE_GEMINI_MODEL?.toString() || DEFAULT_MODEL
}

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
      geminiLog.debug('gemini.runtimeKey.set', { lengthChars: runtimeGeminiApiKey.length })
    } else {
      localStorage.removeItem(RUNTIME_API_KEY_STORAGE)
      geminiLog.debug('gemini.runtimeKey.cleared', {})
    }
  } catch (err) {
    geminiLog.warn('gemini.runtimeKey.storageFailed', normalizeErrorForLog(err))
  }
}

export function clearRuntimeGeminiApiKey() {
  setRuntimeGeminiApiKey('')
}

export function getRuntimeGeminiApiKey() {
  return getRuntimeApiKey() || ''
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
  const modelName = getResolvedGeminiModelName()

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
export async function generateRegenerativeAdvice({ latitude, longitude, lang, correlationId } = {}) {
  const t0 = performance.now()
  const model = getResolvedGeminiModelName()
  geminiLog.info('gemini.soilAdvice.start', { model }, { correlationId })
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

  try {
    const text = await generateGeminiText(prompt)
    geminiLog.info(
      'gemini.soilAdvice.success',
      { model, textChars: typeof text === 'string' ? text.length : 0 },
      { correlationId, durationMs: performance.now() - t0 }
    )
    return text
  } catch (err) {
    geminiLog.error('gemini.soilAdvice.error', normalizeErrorForLog(err), {
      correlationId,
      durationMs: performance.now() - t0,
    })
    throw err
  }
}

// Task 5: Compost wizard recipe generation.
export async function generateCompostRecipe(inventoryInput, { lang, correlationId } = {}) {
  const t0 = performance.now()
  const model = getResolvedGeminiModelName()
  const inventory = normalizeInventory(inventoryInput)
  geminiLog.info(
    'gemini.compost.start',
    { model, inventoryCount: inventory.length },
    { correlationId }
  )
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

  try {
    const text = await generateGeminiText(prompt)
    const json = extractJson(text)
    if (json) {
      geminiLog.info(
        'gemini.compost.success',
        {
          model,
          parseError: false,
          difficultyLevel: json?.difficultyLevel,
          estimatedMaturityTimeMonths: json?.estimatedMaturityTimeMonths,
        },
        { correlationId, durationMs: performance.now() - t0 }
      )
      return json
    }

    geminiLog.warn(
      'gemini.compost.parseFallback',
      { model, rawTextChars: typeof text === 'string' ? text.length : 0 },
      { correlationId, durationMs: performance.now() - t0 }
    )
    return { parseError: true, rawText: text }
  } catch (err) {
    geminiLog.error('gemini.compost.error', normalizeErrorForLog(err), {
      correlationId,
      durationMs: performance.now() - t0,
    })
    throw err
  }
}

// Task 6: Knowledge Hub (permanent categories).
export async function generateKnowledgeHub({ lang, correlationId } = {}) {
  const t0 = performance.now()
  const model = getResolvedGeminiModelName()
  geminiLog.info('gemini.knowledgeHub.start', { model }, { correlationId })
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

  try {
    const text = await generateGeminiText(prompt)
    const json = extractJson(text)
    if (json) {
      const categories = Array.isArray(json?.categories) ? json.categories : []
      geminiLog.info(
        'gemini.knowledgeHub.success',
        {
          model,
          categoryCount: categories.length,
          categoryNames: categories.map((c) => c?.name).filter(Boolean),
        },
        { correlationId, durationMs: performance.now() - t0 }
      )
      return json
    }
    geminiLog.warn(
      'gemini.knowledgeHub.parseFallback',
      { model, rawTextChars: typeof text === 'string' ? text.length : 0 },
      { correlationId, durationMs: performance.now() - t0 }
    )
    return { parseError: true, rawText: text }
  } catch (err) {
    geminiLog.error('gemini.knowledgeHub.error', normalizeErrorForLog(err), {
      correlationId,
      durationMs: performance.now() - t0,
    })
    throw err
  }
}

// Task 6: Smart Alert (weather-driven warning).
export async function generateSmartAlert({
  latitude,
  longitude,
  weatherSummary,
  next48hHourly,
  lang,
  correlationId,
} = {}) {
  const t0 = performance.now()
  const model = getResolvedGeminiModelName()
  geminiLog.info('gemini.smartAlert.start', { model }, { correlationId })
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
  try {
    const text = await generateGeminiText(
      prompt + `\n\n(For reference, JSON blob):\n${JSON.stringify(combined)}`
    )
    const json = extractJson(text)
    if (json) {
      geminiLog.info(
        'gemini.smartAlert.success',
        {
          model,
          riskType: json?.riskType,
          isCritical: Boolean(json?.isCritical),
        },
        { correlationId, durationMs: performance.now() - t0 }
      )
      return json
    }
    geminiLog.warn(
      'gemini.smartAlert.parseFallback',
      { model, rawTextChars: typeof text === 'string' ? text.length : 0 },
      { correlationId, durationMs: performance.now() - t0 }
    )
    return { parseError: true, rawText: text }
  } catch (err) {
    geminiLog.error('gemini.smartAlert.error', normalizeErrorForLog(err), {
      correlationId,
      durationMs: performance.now() - t0,
    })
    throw err
  }
}

export async function generateSoilVitalityScore({ weatherSummary, lang, correlationId } = {}) {
  const t0 = performance.now()
  const model = getResolvedGeminiModelName()
  geminiLog.info('gemini.soilVitality.start', { model }, { correlationId })
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

  try {
    const text = await generateGeminiText(prompt)
    const json = extractJson(text)
    if (json) {
      geminiLog.info(
        'gemini.soilVitality.success',
        { model, soilHealthScore: json?.soilHealthScore, parseError: false },
        { correlationId, durationMs: performance.now() - t0 }
      )
      return json
    }
    geminiLog.warn(
      'gemini.soilVitality.parseFallback',
      { model, rawTextChars: typeof text === 'string' ? text.length : 0 },
      { correlationId, durationMs: performance.now() - t0 }
    )
    return { parseError: true, rawText: text }
  } catch (err) {
    geminiLog.error('gemini.soilVitality.error', normalizeErrorForLog(err), {
      correlationId,
      durationMs: performance.now() - t0,
    })
    throw err
  }
}

// For the UI to verify a runtime-pasted key works.
export async function testGeminiApiKey(apiKey, { correlationId } = {}) {
  const t0 = performance.now()
  geminiLog.info('gemini.apiKeyTest.start', { keyLengthChars: apiKey ? String(apiKey).length : 0 }, { correlationId })
  try {
    const text = await generateGeminiText('Return exactly: OK', {
      apiKeyOverride: apiKey,
    })
    const out = String(text).trim()
    geminiLog.info('gemini.apiKeyTest.success', { responseChars: out.length }, { correlationId, durationMs: performance.now() - t0 })
    return out
  } catch (err) {
    geminiLog.error('gemini.apiKeyTest.error', normalizeErrorForLog(err), {
      correlationId,
      durationMs: performance.now() - t0,
    })
    throw err
  }
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
  correlationId,
} = {}) {
  const t0 = performance.now()
  const imageByteLength = typeof imageBase64 === 'string' ? imageBase64.length : 0
  geminiLog.info(
    'gemini.plantScan.start',
    {
      mimeType: mimeType || 'unknown',
      imageByteLength,
      customPrompt: Boolean(prompt),
    },
    { correlationId }
  )
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

  // One model only: free tier limits are per model per day (e.g. 20 RPD); a fallback model doubles usage on every scan.
  const modelsToTry = [getResolvedGeminiModelName()]
  let lastErr = null

  for (const modelName of modelsToTry) {
    try {
      const model = getGeminiModelByName(modelName, null)
      const result = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [{ text: plantScanPrompt }, { inlineData }],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
        },
      })

      const text = result?.response?.text?.() ?? ''
      const json = extractJson(text)
      if (json) {
        geminiLog.info(
          'gemini.plantScan.success',
          {
            model: modelName,
            healthStatus: json?.healthStatus,
            parseError: false,
          },
          { correlationId, durationMs: performance.now() - t0 }
        )
        return json
      }
      geminiLog.warn(
        'gemini.plantScan.parseFallback',
        { model: modelName, rawTextChars: typeof text === 'string' ? text.length : 0 },
        { correlationId, durationMs: performance.now() - t0 }
      )
      return { parseError: true, rawText: text }
    } catch (err) {
      lastErr = err
    }
  }

  const msg = lastErr?.message ? lastErr.message : String(lastErr)
  geminiLog.error(
    'gemini.plantScan.error',
    { ...normalizeErrorForLog(lastErr || new Error(msg)), modelsTried: modelsToTry },
    { correlationId, durationMs: performance.now() - t0 }
  )
  // Do not conflate API failures (e.g. 429 quota) with JSON parse failures — rethrow so the UI can show the real message.
  throw lastErr || new Error(msg)
}

// Task 9: Daily Task Engine.
export async function generateDailyTasks({ weatherSummary, soilHealthScore, lang, correlationId } = {}) {
  const t0 = performance.now()
  const model = getResolvedGeminiModelName()
  geminiLog.info(
    'gemini.dailyTasks.start',
    { model, soilHealthScore },
    { correlationId }
  )
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

  try {
    const text = await generateGeminiText(prompt)
    const json = extractJson(text)
    const tasks = Array.isArray(json?.tasks) ? json.tasks : []
    if (json) {
      const schemaValid = tasks.length === 3
      geminiLog.info(
        'gemini.dailyTasks.success',
        {
          model,
          taskCount: tasks.length,
          schemaValid,
          expectedTaskCount: 3,
        },
        { correlationId, durationMs: performance.now() - t0 }
      )
      return json
    }
    geminiLog.warn(
      'gemini.dailyTasks.parseFallback',
      { model, rawTextChars: typeof text === 'string' ? text.length : 0 },
      { correlationId, durationMs: performance.now() - t0 }
    )
    return { parseError: true, rawText: text }
  } catch (err) {
    geminiLog.error('gemini.dailyTasks.error', normalizeErrorForLog(err), {
      correlationId,
      durationMs: performance.now() - t0,
    })
    throw err
  }
}

