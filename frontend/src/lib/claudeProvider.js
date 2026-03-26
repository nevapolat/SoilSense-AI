import Anthropic from '@anthropic-ai/sdk'
import { createLogger, normalizeErrorForLog } from './logger'
import { extractJson } from './llmJson.js'
import { estimateTextTokens, estimateBase64PayloadTokens } from './tokenEstimate.js'
import {
  REG_AGRI_EXPERT_PERSONA,
  buildJsonTaskLanguageConstraint,
  buildLanguageInstruction,
  formatCoords,
  normalizeInventory,
} from './llmShared.js'

// Snapshot IDs like claude-3-5-sonnet-20241022 may be retired; use a current ID (see Anthropic models docs).
const DEFAULT_MODEL = 'claude-sonnet-4-20250514'
const DEFAULT_HAIKU_MODEL = 'claude-haiku-4-5-20251001'

const claudeLog = createLogger('claude')

export function getResolvedClaudeModelName() {
  return import.meta.env.VITE_CLAUDE_MODEL?.toString() || DEFAULT_MODEL
}

export function getResolvedClaudeHaikuModelName() {
  return import.meta.env.VITE_CLAUDE_HAIKU_MODEL?.toString() || DEFAULT_HAIKU_MODEL
}

function resolveClaudeModelForFeature(feature) {
  const raw = import.meta.env.VITE_CLAUDE_HAIKU_FEATURES
  const features = typeof raw === 'string' ? raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : []
  if (!features.length) return getResolvedClaudeModelName()
  const f = typeof feature === 'string' ? feature.trim().toLowerCase() : ''
  if (!f) return getResolvedClaudeModelName()
  return features.includes(f) ? getResolvedClaudeHaikuModelName() : getResolvedClaudeModelName()
}

const RUNTIME_API_KEY_STORAGE = 'soilsense.runtimeAnthropicApiKey'

let runtimeAnthropicApiKey = null

function getRuntimeApiKey() {
  if (runtimeAnthropicApiKey) return runtimeAnthropicApiKey
  try {
    runtimeAnthropicApiKey = localStorage.getItem(RUNTIME_API_KEY_STORAGE)
  } catch {
    // ignore (localStorage may be unavailable)
  }
  return runtimeAnthropicApiKey
}

export function setRuntimeAnthropicApiKey(apiKey) {
  const cleaned = apiKey ? String(apiKey).trim() : ''
  runtimeAnthropicApiKey = cleaned || null
  try {
    if (runtimeAnthropicApiKey) {
      localStorage.setItem(RUNTIME_API_KEY_STORAGE, runtimeAnthropicApiKey)
      claudeLog.debug('claude.runtimeKey.set', { lengthChars: runtimeAnthropicApiKey.length })
    } else {
      localStorage.removeItem(RUNTIME_API_KEY_STORAGE)
      claudeLog.debug('claude.runtimeKey.cleared', {})
    }
  } catch (err) {
    claudeLog.warn('claude.runtimeKey.storageFailed', normalizeErrorForLog(err))
  }
}

export function clearRuntimeAnthropicApiKey() {
  setRuntimeAnthropicApiKey('')
}

export function getRuntimeAnthropicApiKey() {
  return getRuntimeApiKey() || ''
}

function requireAnthropicKey(apiKeyOverride) {
  const envKey = import.meta.env.VITE_ANTHROPIC_API_KEY
  const apiKey = apiKeyOverride ?? getRuntimeApiKey() ?? envKey
  if (!apiKey) {
    throw new Error(
      'Missing VITE_ANTHROPIC_API_KEY. Set it in frontend/.env and restart the dev server (use VITE_LLM_PROVIDER=claude).'
    )
  }
  return apiKey
}

function textFromMessage(msg) {
  if (!msg?.content) return ''
  return msg.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function generateClaudeText(prompt, { apiKeyOverride, modelOverride } = {}) {
  const client = new Anthropic({
    apiKey: requireAnthropicKey(apiKeyOverride),
    dangerouslyAllowBrowser: true,
  })

  const modelName =
    typeof modelOverride === 'string' && modelOverride.trim() ? modelOverride.trim() : getResolvedClaudeModelName()

  const maxAttempts = 3
  let lastErr = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const msg = await client.messages.create({
        model: modelName,
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      })
      const out = textFromMessage(msg)
      claudeLog.info('claude.tokens.estimate', {
        kind: 'text',
        model: modelName,
        promptChars: typeof prompt === 'string' ? prompt.length : 0,
        outputChars: typeof out === 'string' ? out.length : 0,
        estPromptTokens: estimateTextTokens(prompt),
        estOutputTokens: estimateTextTokens(out),
      })
      return out
    } catch (err) {
      lastErr = err
      const msg = err?.message ? err.message : String(err)
      if (/401|403|invalid|authentication|api[_ ]?key/i.test(msg)) {
        throw new Error(
          'Anthropic API key is not usable. Set `VITE_ANTHROPIC_API_KEY` in frontend/.env or paste a key in the Dashboard testing panel.'
        )
      }

      // Handle temporary overload/rate spikes with bounded retries.
      const isTransient =
        /529|overloaded|overload|rate[_ -]?limit|temporar|try again/i.test(msg) ||
        Number(err?.status) === 529 ||
        Number(err?.status) === 429
      const shouldRetry = isTransient && attempt < maxAttempts
      if (shouldRetry) {
        await sleep(400 * attempt)
        continue
      }

      if (isTransient) {
        throw new Error(
          'AI service is temporarily overloaded. Please retry in a few seconds.'
        )
      }
      throw err
    }
  }
  throw lastErr || new Error('Claude request failed.')
}

// Main AI entry point for SoilSense.
export async function generateRegenerativeAdvice({
  location,
  weatherSignals,
  lang,
  correlationId,
  profile,
  activityImpact,
  soilHealthScore,
} = {}) {
  const t0 = performance.now()
  const model = getResolvedClaudeModelName()
  claudeLog.info('claude.soilAdvice.start', { model }, { correlationId })
  const locationLine = formatCoords(location?.latitude, location?.longitude)
  const addressLine = typeof location?.address === 'string' && location.address.trim() ? location.address.trim() : 'unknown'

  const equipment = profile?.equipment && typeof profile.equipment === 'object' ? profile.equipment : {}
  const equipmentCustom = Array.isArray(equipment?.custom)
    ? equipment.custom.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean).slice(0, 6)
    : []
  const equipmentList = [
    equipment?.shovel ? 'shovel' : null,
    equipment?.tractor ? 'tractor' : null,
    equipment?.sprinkler ? 'sprinkler' : null,
    equipment?.dripIrrigation ? 'drip irrigation' : null,
    ...equipmentCustom,
  ]
    .filter(Boolean)
    .join(', ')

  const fieldSizePart =
    typeof profile?.fieldSize?.value === 'number'
      ? `${profile.fieldSize.value} ${profile.fieldSize.unit}`
      : 'not provided'
  const soilTypePart = profile?.soilType || 'unknown'
  const soilTypeLower = String(soilTypePart).toLowerCase()
  const soilIsSandy = soilTypeLower.includes('sandy') || soilTypeLower.includes('sand')
  const workforcePart =
    typeof profile?.workforce === 'number' && Number.isFinite(profile.workforce) ? String(profile.workforce) : 'unknown'

  const climateZoneHint = typeof location?.climateZone === 'string' ? location.climateZone : 'unknown'

  const tempNowC = typeof weatherSignals?.tempNowC === 'number' ? weatherSignals.tempNowC : null
  const humidityNowPct = typeof weatherSignals?.humidityNowPct === 'number' ? weatherSignals.humidityNowPct : null
  const windKph = typeof weatherSignals?.windKph === 'number' ? weatherSignals.windKph : null
  const precipNowMm = typeof weatherSignals?.precipNowMm === 'number' ? weatherSignals.precipNowMm : null
  const precipSumMm = typeof weatherSignals?.precipitationSumMm === 'number' ? weatherSignals.precipitationSumMm : null
  const humidityBucket = typeof weatherSignals?.humidityBucket === 'string' ? weatherSignals.humidityBucket : null
  const sunBucket = typeof weatherSignals?.sunBucket === 'string' ? weatherSignals.sunBucket : null
  const frostRisk48h =
    typeof weatherSignals?.firstBelow2CInHours === 'number'
      ? weatherSignals.firstBelow2CInHours <= 48
      : typeof weatherSignals?.next48hMinTempC === 'number' && typeof weatherSignals?.frostThresholdC === 'number'
        ? weatherSignals.next48hMinTempC < weatherSignals.frostThresholdC
        : false

  const compostRecentlyAdded = Boolean(activityImpact?.compostRecentlyAdded)

  const organicKg = typeof activityImpact?.organicKg === 'number' ? activityImpact.organicKg : 0
  const organicCount = typeof activityImpact?.organicCount === 'number' ? activityImpact.organicCount : 0
  const chemPestLiters =
    typeof activityImpact?.chemicalPesticideLiters === 'number' ? activityImpact.chemicalPesticideLiters : 0
  const chemPestCount =
    typeof activityImpact?.chemicalPesticideCount === 'number' ? activityImpact.chemicalPesticideCount : 0
  const chemFertKg = typeof activityImpact?.chemicalFertilizerKg === 'number' ? activityImpact.chemicalFertilizerKg : 0
  const chemFertCount =
    typeof activityImpact?.chemicalFertilizerCount === 'number' ? activityImpact.chemicalFertilizerCount : 0
  const chemicalRecentlyApplied = Boolean(activityImpact?.chemicalRecentlyApplied)

  // Simple "pressure" bucket so the prompt can be more deterministic.
  const pesticidePressure =
    chemPestCount >= 2 || chemPestLiters >= 5
      ? 'high'
      : chemPestCount > 0 || chemPestLiters > 0
        ? 'moderate'
        : 'none'

  const soilHealthScorePart = typeof soilHealthScore === 'number' ? soilHealthScore : null

  const prompt = `${REG_AGRI_EXPERT_PERSONA}

${buildLanguageInstruction(lang)}

User request:
Use a warm, supportive, conversational tone. Keep it practical and easy to understand (avoid heavy jargon).
Provide next-step advice to improve soil health and increase organic carbon.
Be specific about regenerative practices (e.g., cover crops, compost, reduced tillage, mulching, grazing management, soil testing cadence).

Location-aware context:
Address: ${addressLine}
${locationLine}
Climate zone hint: ${climateZoneHint}

Recent local weather (approx, from nearby forecast):
- Temp now: ${tempNowC == null ? 'unknown' : tempNowC} C
- Humidity now: ${humidityNowPct == null ? 'unknown' : humidityNowPct}%${humidityBucket ? ' (' + humidityBucket + ')' : ''}
- Wind: ${windKph == null ? 'unknown' : windKph} kph
- Precip now: ${precipNowMm == null ? 'unknown' : precipNowMm} mm
- Precip sum (recent daily): ${precipSumMm == null ? 'unknown' : precipSumMm} mm
- Sun/heat bucket: ${sunBucket == null ? 'unknown' : sunBucket}
- Frost risk (<=2C): ${frostRisk48h ? 'yes' : 'no'}

Farmer context (personalization + constraints):
- Soil type: ${soilTypePart}
- Field size: ${fieldSizePart}
- Workforce: ${workforcePart} people
- Available equipment: ${equipmentList || 'manual tools only'}
- Recent activity (last ~7 days):
  - Organic inputs: ${organicKg} kg across ${organicCount} events
  - Compost recently added: ${compostRecentlyAdded ? 'yes' : 'no'}
  - Chemical pesticides: ${chemPestLiters} liters across ${chemPestCount} events
  - Chemical fertilizer: ${chemFertKg} kg across ${chemFertCount} events

Farmer progress signal:
- Current soil health score (from your activity): ${
    soilHealthScorePart == null ? 'unknown' : soilHealthScorePart
  }/100

Constraints:
- If no tractor is available, do NOT suggest mechanized tasks that require a tractor.
- If no drip irrigation is available, do NOT suggest drip-specific irrigation instructions.
- If chemical pesticides were applied recently (${chemicalRecentlyApplied ? 'yes' : 'no'}), prioritize monitoring + soil biology recovery and avoid recommending further chemical sprays.

- If soil type suggests sandy (${soilIsSandy ? 'yes' : 'no'}) and pesticide pressure is ${pesticidePressure} (moderate/high), prioritize rebuilding organic matter (compost, mulching, cover crops) and avoid recommending additional chemical pesticides.
- If the climate zone hint suggests dryness (Dry / Dry & Hot / Dry & Warm), prioritize moisture retention with mulching and careful watering, and reduce bare-soil exposure.
- If the climate zone hint suggests wet conditions (Humid / Wet), prioritize ground cover, reduce runoff/erosion, and avoid over-activating soils.
- If frost risk is 'yes', recommend protective soil cover and avoid anything likely to increase frost damage.

Return plain text (no markdown), with these sections:
1) Soil health snapshot
2) Organic carbon building plan (5 bullet points)
3) What to measure (soil indicators to track)
4) 30-day starter actions

Keep it concise, friendly, and actionable. Avoid heavy jargon. Use simple farmer language.`

  try {
    const text = await generateClaudeText(prompt)
    claudeLog.info(
      'claude.soilAdvice.success',
      { model, textChars: typeof text === 'string' ? text.length : 0 },
      { correlationId, durationMs: performance.now() - t0 }
    )
    return text
  } catch (err) {
    claudeLog.error('claude.soilAdvice.error', normalizeErrorForLog(err), {
      correlationId,
      durationMs: performance.now() - t0,
    })
    throw err
  }
}

// Task 5: Compost wizard recipe generation.
export async function generateCompostRecipe(inventoryInput, { lang, correlationId } = {}) {
  const t0 = performance.now()
  const model = getResolvedClaudeModelName()
  const inventory = normalizeInventory(inventoryInput)
  claudeLog.info(
    'claude.compost.start',
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
    const text = await generateClaudeText(prompt)
    const json = extractJson(text)
    if (json) {
      claudeLog.info(
        'claude.compost.success',
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

    claudeLog.warn(
      'claude.compost.parseFallback',
      { model, rawTextChars: typeof text === 'string' ? text.length : 0 },
      { correlationId, durationMs: performance.now() - t0 }
    )
    return { parseError: true, rawText: text }
  } catch (err) {
    claudeLog.error('claude.compost.error', normalizeErrorForLog(err), {
      correlationId,
      durationMs: performance.now() - t0,
    })
    throw err
  }
}

// Task 6: Knowledge Hub (permanent categories).
export async function generateKnowledgeHub({ lang, correlationId } = {}) {
  const t0 = performance.now()
  const model = resolveClaudeModelForFeature('knowledgeHub')
  claudeLog.info('claude.knowledgeHub.start', { model }, { correlationId })
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
    const text = await generateClaudeText(prompt, { modelOverride: model })
    const json = extractJson(text)
    if (json) {
      const categories = Array.isArray(json?.categories) ? json.categories : []
      claudeLog.info(
        'claude.knowledgeHub.success',
        {
          model,
          categoryCount: categories.length,
          categoryNames: categories.map((c) => c?.name).filter(Boolean),
        },
        { correlationId, durationMs: performance.now() - t0 }
      )
      return json
    }
    claudeLog.warn(
      'claude.knowledgeHub.parseFallback',
      { model, rawTextChars: typeof text === 'string' ? text.length : 0 },
      { correlationId, durationMs: performance.now() - t0 }
    )
    return { parseError: true, rawText: text }
  } catch (err) {
    claudeLog.error('claude.knowledgeHub.error', normalizeErrorForLog(err), {
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
  const model = resolveClaudeModelForFeature('smartAlert')
  claudeLog.info('claude.smartAlert.start', { model }, { correlationId })
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
    const text = await generateClaudeText(
      `${prompt}\n\n(For reference, JSON blob):\n${JSON.stringify(combined)}`,
      { modelOverride: model }
    )
    const json = extractJson(text)
    if (json) {
      claudeLog.info(
        'claude.smartAlert.success',
        {
          model,
          riskType: json?.riskType,
          isCritical: Boolean(json?.isCritical),
        },
        { correlationId, durationMs: performance.now() - t0 }
      )
      return json
    }
    claudeLog.warn(
      'claude.smartAlert.parseFallback',
      { model, rawTextChars: typeof text === 'string' ? text.length : 0 },
      { correlationId, durationMs: performance.now() - t0 }
    )
    return { parseError: true, rawText: text }
  } catch (err) {
    claudeLog.error('claude.smartAlert.error', normalizeErrorForLog(err), {
      correlationId,
      durationMs: performance.now() - t0,
    })
    throw err
  }
}

export async function generateSoilVitalityScore({ weatherSummary, lang, correlationId } = {}) {
  const t0 = performance.now()
  const model = getResolvedClaudeModelName()
  claudeLog.info('claude.soilVitality.start', { model }, { correlationId })
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
    const text = await generateClaudeText(prompt)
    const json = extractJson(text)
    if (json) {
      claudeLog.info(
        'claude.soilVitality.success',
        { model, soilHealthScore: json?.soilHealthScore, parseError: false },
        { correlationId, durationMs: performance.now() - t0 }
      )
      return json
    }
    claudeLog.warn(
      'claude.soilVitality.parseFallback',
      { model, rawTextChars: typeof text === 'string' ? text.length : 0 },
      { correlationId, durationMs: performance.now() - t0 }
    )
    return { parseError: true, rawText: text }
  } catch (err) {
    claudeLog.error('claude.soilVitality.error', normalizeErrorForLog(err), {
      correlationId,
      durationMs: performance.now() - t0,
    })
    throw err
  }
}

// For the UI to verify a runtime-pasted key works.
export async function testClaudeApiKey(apiKey, { correlationId } = {}) {
  const t0 = performance.now()
  claudeLog.info('claude.apiKeyTest.start', { keyLengthChars: apiKey ? String(apiKey).length : 0 }, { correlationId })
  try {
    const text = await generateClaudeText('Return exactly: OK', {
      apiKeyOverride: apiKey,
    })
    const out = String(text).trim()
    claudeLog.info('claude.apiKeyTest.success', { responseChars: out.length }, { correlationId, durationMs: performance.now() - t0 })
    return out
  } catch (err) {
    claudeLog.error('claude.apiKeyTest.error', normalizeErrorForLog(err), {
      correlationId,
      durationMs: performance.now() - t0,
    })
    throw err
  }
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
  const modelName = getResolvedClaudeModelName()
  claudeLog.info(
    'claude.plantScan.start',
    {
      mimeType: mimeType || 'unknown',
      imageByteLength,
      customPrompt: Boolean(prompt),
      estImagePayloadTokens: estimateBase64PayloadTokens(imageBase64),
      estPromptTokens: estimateTextTokens(prompt || ''),
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

  const mediaType =
    mimeType && /^image\/(jpeg|png|gif|webp)$/i.test(mimeType) ? mimeType : 'image/jpeg'

  const client = new Anthropic({
    apiKey: requireAnthropicKey(null),
    dangerouslyAllowBrowser: true,
  })

  try {
    const msg = await client.messages.create({
      model: modelName,
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: `${plantScanPrompt}\n\nOutput only the JSON object, no markdown.`,
            },
          ],
        },
      ],
    })

    const text = textFromMessage(msg)
    const json = extractJson(text)
    if (json) {
      claudeLog.info(
        'claude.plantScan.success',
        {
          model: modelName,
          healthStatus: json?.healthStatus,
          parseError: false,
        },
        { correlationId, durationMs: performance.now() - t0 }
      )
      return json
    }
    claudeLog.warn(
      'claude.plantScan.parseFallback',
      { model: modelName, rawTextChars: typeof text === 'string' ? text.length : 0 },
      { correlationId, durationMs: performance.now() - t0 }
    )
    return { parseError: true, rawText: text }
  } catch (err) {
    const msg = err?.message ? err.message : String(err)
    claudeLog.error(
      'claude.plantScan.error',
      { ...normalizeErrorForLog(err || new Error(msg)), modelsTried: [modelName] },
      { correlationId, durationMs: performance.now() - t0 }
    )
    throw err || new Error(msg)
  }
}

// Task 9: Daily Task Engine.
export async function generateDailyTasks({
  weatherSummary,
  soilHealthScore,
  lang,
  correlationId,
  profile,
  activityImpact,
  preferredCropsSummary,
} = {}) {
  const t0 = performance.now()
  const model = resolveClaudeModelForFeature('dailyTasks')
  claudeLog.info(
    'claude.dailyTasks.start',
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

Farmer context (personalization + constraints):
- Soil type: ${profile?.soilType || 'unknown'}
- Field size: ${
  typeof profile?.fieldSize?.value === 'number' ? `${profile.fieldSize.value} ${profile.fieldSize.unit}` : 'not provided'
}
- Workforce: ${
  typeof profile?.workforce === 'number' && Number.isFinite(profile.workforce) ? String(profile.workforce) : 'unknown'
} people
- Available equipment: ${
  profile?.equipment
    ? [
        profile.equipment.shovel ? 'shovel' : null,
        profile.equipment.tractor ? 'tractor' : null,
        profile.equipment.sprinkler ? 'sprinkler' : null,
        profile.equipment.dripIrrigation ? 'drip irrigation' : null,
      ]
        .filter(Boolean)
        .join(', ')
    : 'manual tools only'
}
- Crops/plants the farmer is growing (from profile): ${
    typeof preferredCropsSummary === 'string' && preferredCropsSummary.trim()
      ? preferredCropsSummary.trim()
      : 'not specified'
  }
- Recent activity (last ~7 days):
  - Organic inputs: ${typeof activityImpact?.organicKg === 'number' ? activityImpact.organicKg : 0} kg across ${
    typeof activityImpact?.organicCount === 'number' ? activityImpact.organicCount : 0
  } events
  - Chemical pesticides: ${typeof activityImpact?.chemicalPesticideLiters === 'number' ? activityImpact.chemicalPesticideLiters : 0} liters across ${
    typeof activityImpact?.chemicalPesticideCount === 'number' ? activityImpact.chemicalPesticideCount : 0
  } events
  - Chemical fertilizer: ${typeof activityImpact?.chemicalFertilizerKg === 'number' ? activityImpact.chemicalFertilizerKg : 0} kg across ${
    typeof activityImpact?.chemicalFertilizerCount === 'number' ? activityImpact.chemicalFertilizerCount : 0
  } events

Constraints:
- If no tractor is available, avoid mechanized tasks that require a tractor.
- If no drip irrigation is available, avoid drip-specific irrigation tasks.
- If chemical pesticides were applied recently, prioritize monitoring + soil biology recovery and avoid recommending further chemical sprays.
- If specific crops/plants are listed above, tailor at least one task to their needs (soil prep, irrigation, scouting, or organic matter).

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
- estimatedMinutes between 5 and 45
${buildJsonTaskLanguageConstraint(lang)}`

  try {
    const text = await generateClaudeText(prompt, { modelOverride: model })
    const json = extractJson(text)
    const tasks = Array.isArray(json?.tasks) ? json.tasks : []
    if (json) {
      const schemaValid = tasks.length === 3
      claudeLog.info(
        'claude.dailyTasks.success',
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
    claudeLog.warn(
      'claude.dailyTasks.parseFallback',
      { model, rawTextChars: typeof text === 'string' ? text.length : 0 },
      { correlationId, durationMs: performance.now() - t0 }
    )
    return { parseError: true, rawText: text }
  } catch (err) {
    claudeLog.error('claude.dailyTasks.error', normalizeErrorForLog(err), {
      correlationId,
      durationMs: performance.now() - t0,
    })
    throw err
  }
}

export async function generateLocationEnvironmentalAnalysis({
  address,
  latitude,
  longitude,
  weatherSummary,
  lang,
  correlationId,
} = {}) {
  const t0 = performance.now()
  const model = getResolvedClaudeModelName()
  claudeLog.info('claude.locationIntel.start', { model }, { correlationId })
  const locationLine = formatCoords(latitude, longitude)
  const prompt = `${REG_AGRI_EXPERT_PERSONA}
${buildLanguageInstruction(lang)}
Analyze this farming location and return practical environmental intelligence.

Location:
- Address: ${address || 'unknown'}
- ${locationLine}

Weather summary:
${JSON.stringify(weatherSummary || {})}

Return ONLY strict JSON:
{
  "climateZone": string,
  "generalSoilCharacteristics": string[],
  "cropSuitability": string[],
  "regionalSummary": string
}

Rules:
- Keep "generalSoilCharacteristics" to 3-5 concise items.
- Keep "cropSuitability" to 4-8 region-appropriate crop names.
- "regionalSummary" should be 1 short sentence for farmers.`
  try {
    const text = await generateClaudeText(prompt)
    const json = extractJson(text)
    if (json) return json
    return { parseError: true, rawText: text }
  } catch (err) {
    claudeLog.error('claude.locationIntel.error', normalizeErrorForLog(err), {
      correlationId,
      durationMs: performance.now() - t0,
    })
    throw err
  }
}

export async function generateFarmDailyInsight({
  locationContext,
  weatherSignals,
  soilSignals,
  climatePatterns,
  userActions,
  cropType,
  farmMemory,
  lang,
  correlationId,
} = {}) {
  const t0 = performance.now()
  const model = getResolvedClaudeModelName()
  claudeLog.info('claude.farmDailyInsight.start', { model }, { correlationId })

  const locationUsed =
    typeof locationContext?.locationUsed === 'string' && locationContext.locationUsed.trim()
      ? locationContext.locationUsed.trim()
      : 'unknown'

  const prompt = `${REG_AGRI_EXPERT_PERSONA}
${buildLanguageInstruction(lang)}

You are SoilSense AI, a long-term agricultural intelligence system.

Rules:
- Always prioritize manual farm location over device GPS.
- If location is unclear, ask for clarification in the daily_summary and set confidence_level to "low".
- Never reset memory unless explicitly instructed.
- Use farm memory as time-series history. Prioritize recent data but include trend context.
- Keep the tone warm, supportive, and practical for farmers.
- Avoid generic advice and avoid heavy jargon.
- Return ONLY strict JSON with this schema:
{
  "location_used": string,
  "daily_summary": string,
  "detected_changes": string,
  "soil_health_status": string,
  "recommendations": string[],
  "confidence_level": "low" | "medium" | "high"
}

Input context:
locationContext: ${JSON.stringify(locationContext || {})}
weatherSignals: ${JSON.stringify(weatherSignals || {})}
soilSignals: ${JSON.stringify(soilSignals || {})}
climatePatterns: ${JSON.stringify(climatePatterns || {})}
userActions: ${JSON.stringify(userActions || [])}
cropType: ${JSON.stringify(cropType || null)}
farmMemory: ${JSON.stringify(farmMemory || {})}

Output constraints:
- location_used must equal "${locationUsed}" unless unknown.
- recommendations must include 3-6 specific, actionable steps.
- detected_changes must mention meaningful trend shifts when history exists.
- Keep values concise and practical for a farmer.`

  try {
    const text = await generateClaudeText(prompt)
    const json = extractJson(text)
    if (json) return json
    return { parseError: true, rawText: text }
  } catch (err) {
    claudeLog.error('claude.farmDailyInsight.error', normalizeErrorForLog(err), {
      correlationId,
      durationMs: performance.now() - t0,
    })
    throw err
  }
}

