import './App.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BadgeCheck, BookOpen, Leaf, TreePine, Camera, Globe2, Sun, Droplet, Map } from 'lucide-react'
import {
  generateKnowledgeHub,
  generateFarmDailyInsight,
  generateSoilVitalityScore,
  buildSoilVitalityScoreFallback,
  generateDailyTasks,
  generateLocationEnvironmentalAnalysis,
  clearRuntimeGeminiApiKey,
  getRuntimeGeminiApiKey,
  setRuntimeGeminiApiKey,
  testGeminiApiKey,
} from './lib/gemini'
import CompostWizard from './components/CompostWizard'
import CompostGuide from './components/CompostGuide'
import SoilVitalityScore from './components/SoilVitalityScore'
import PlantScanner from './components/PlantScanner'
import DiagnosticsPanel from './components/DiagnosticsPanel'
import { useI18n } from './i18n/useI18n'
import { bucketAccuracyMeters, createLogger, generateRunId, normalizeErrorForLog } from './lib/logger'
import EducationalGuide from './components/EducationalGuide'
import FieldPlanner from './components/FieldPlanner'
import { buildCropDrivenDailyTasks, buildFieldPlan, getAvailableCrops } from './lib/fieldPlanner'
import { geocodeFieldAddress } from './lib/geocoding'
import {
  appendFarmMemoryEntry,
  buildDetectedChangesFromMemory,
  loadFarmMemory,
  resolveFarmLocationContext,
} from './lib/farmMemory'

const storageLog = createLogger('storage')
const geoLog = createLogger('geo')
const uiLog = createLogger('ui')
const appLog = createLogger('app')
const weatherLog = createLogger('weather')

function coordsKey(c) {
  // Small rounding so repeated measurements don't re-trigger AI calls constantly.
  return `${Number(c.latitude).toFixed(3)},${Number(c.longitude).toFixed(3)}`
}

function toFixedOrDash(n, digits) {
  if (typeof n !== 'number' || Number.isNaN(n)) return '—'
  return n.toFixed(digits)
}

const PROFILE_STORAGE_KEY = 'soilsense.profile'
const ACTIVITY_LOG_STORAGE_KEY = 'soilsense.activityLog'
const GREEN_POINT_EVENTS_KEY = 'soilsense.greenPointEvents'
const WEATHER_HISTORY_STORAGE_KEY = 'soilsense.weatherHistory'

const ACTIVITY_TYPES = [
  { id: 'added-eggshells', category: 'organic-matter', defaultQuantity: 1, defaultUnit: 'kg' },
  { id: 'watered', category: 'water', defaultQuantity: 1, defaultUnit: 'liters' },
  { id: 'added-compost', category: 'organic-matter', defaultQuantity: 5, defaultUnit: 'kg' },
  { id: 'used-organic-fertilizer', category: 'organic-matter', defaultQuantity: 2, defaultUnit: 'kg' },
  { id: 'pesticide-application', category: 'pesticide', defaultQuantity: 1, defaultUnit: 'liters' },
  { id: 'fertilizer-application', category: 'fertilizer', defaultQuantity: 1, defaultUnit: 'kg' },
]

function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY)
    if (!raw) {
      storageLog.debug('storage.read', { key: PROFILE_STORAGE_KEY, hit: false })
      return null
    }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      storageLog.warn('storage.read.invalid', { key: PROFILE_STORAGE_KEY, bytes: raw.length })
      return null
    }
    storageLog.info('storage.read', { key: PROFILE_STORAGE_KEY, hit: true, bytes: raw.length })
    return parsed
  } catch (err) {
    storageLog.warn('storage.read.failed', { key: PROFILE_STORAGE_KEY, ...normalizeErrorForLog(err) })
    return null
  }
}

function normalizeProfile(profile) {
  const p = profile && typeof profile === 'object' ? profile : {}
  const soilType = typeof p.soilType === 'string' ? p.soilType : 'loam'
  const latitude = typeof p.latitude === 'number' ? p.latitude : null
  const longitude = typeof p.longitude === 'number' ? p.longitude : null
  const address = typeof p.address === 'string' ? p.address.trim() : ''

  const fieldSizeRaw = p.fieldSize && typeof p.fieldSize === 'object' ? p.fieldSize : {}
  const fieldSizeValue =
    typeof fieldSizeRaw.value === 'number' && Number.isFinite(fieldSizeRaw.value) ? fieldSizeRaw.value : null
  const fieldSizeUnit = fieldSizeRaw.unit === 'sqm' || fieldSizeRaw.unit === 'ha' ? fieldSizeRaw.unit : 'ha'

  const workforce = typeof p.workforce === 'number' && Number.isFinite(p.workforce) ? p.workforce : null

  const equipmentRaw = p.equipment && typeof p.equipment === 'object' ? p.equipment : {}
  const currentCrops = Array.isArray(p.currentCrops) ? p.currentCrops.filter((x) => typeof x === 'string') : []
  const equipment = {
    shovel: Boolean(equipmentRaw.shovel),
    tractor: Boolean(equipmentRaw.tractor),
    sprinkler: Boolean(equipmentRaw.sprinkler),
    dripIrrigation: Boolean(equipmentRaw.dripIrrigation),
  }

  return {
    soilType,
    address,
    latitude,
    longitude,
    fieldSize: { value: fieldSizeValue, unit: fieldSizeUnit },
    workforce,
    currentCrops,
    equipment,
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : undefined,
  }
}

function loadActivityLog() {
  try {
    const raw = localStorage.getItem(ACTIVITY_LOG_STORAGE_KEY)
    if (!raw) {
      storageLog.debug('storage.read', { key: ACTIVITY_LOG_STORAGE_KEY, hit: false })
      return []
    }
    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed) ? parsed : []
    storageLog.info('storage.read', { key: ACTIVITY_LOG_STORAGE_KEY, hit: true, bytes: raw.length, count: list.length })
    return list
  } catch (err) {
    storageLog.warn('storage.read.failed', { key: ACTIVITY_LOG_STORAGE_KEY, ...normalizeErrorForLog(err) })
    return []
  }
}

function appendWeatherSnapshot(signals) {
  if (!signals || typeof signals !== 'object') return
  const entry = {
    timestamp: new Date().toISOString(),
    tempNowC: typeof signals.tempNowC === 'number' ? signals.tempNowC : null,
    humidityNowPct: typeof signals.humidityNowPct === 'number' ? signals.humidityNowPct : null,
    windKph: typeof signals.windKph === 'number' ? signals.windKph : null,
    precipitationSumMm: typeof signals.precipitationSumMm === 'number' ? signals.precipitationSumMm : null,
    next48hMinTempC: typeof signals.next48hMinTempC === 'number' ? signals.next48hMinTempC : null,
    humidityBucket: typeof signals.humidityBucket === 'string' ? signals.humidityBucket : 'unknown',
    sunBucket: typeof signals.sunBucket === 'string' ? signals.sunBucket : 'unknown',
  }
  try {
    const raw = localStorage.getItem(WEATHER_HISTORY_STORAGE_KEY)
    const prev = raw ? JSON.parse(raw) : []
    const list = Array.isArray(prev) ? prev : []
    const latest = list[0]
    const sameSnapshot =
      latest &&
      latest.tempNowC === entry.tempNowC &&
      latest.humidityNowPct === entry.humidityNowPct &&
      latest.windKph === entry.windKph &&
      latest.precipitationSumMm === entry.precipitationSumMm &&
      latest.next48hMinTempC === entry.next48hMinTempC
    if (sameSnapshot) return
    const next = [entry, ...list].slice(0, 120)
    localStorage.setItem(WEATHER_HISTORY_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // best effort persistence
  }
}

function buildSmartAlertFallback(signals, t) {
  const tNow = signals?.tempNowC
  const tMin = signals?.tempMinC
  const tMax = signals?.tempMaxC
  const precipSumMm = signals?.precipitationSumMm
  const windKph = signals?.windKph
  const humidity = signals?.humidityNowPct

  const frostThresholdC =
    typeof signals?.frostThresholdC === 'number' ? signals.frostThresholdC : 2.0
  const firstBelow2CInHours =
    typeof signals?.firstBelow2CInHours === 'number' ? signals.firstBelow2CInHours : null
  const next48hMinTempC =
    typeof signals?.next48hMinTempC === 'number' ? signals.next48hMinTempC : null

  const frostRisk =
    (typeof firstBelow2CInHours === 'number' ? firstBelow2CInHours <= 48 : false) ||
    (typeof next48hMinTempC === 'number' ? next48hMinTempC < frostThresholdC : false) ||
    (typeof tMin === 'number'
      ? tMin <= frostThresholdC
      : typeof tNow === 'number'
        ? tNow <= frostThresholdC
        : false)
  const heavyRainRisk =
    typeof precipSumMm === 'number' ? precipSumMm >= 10 || precipSumMm >= 5 : false
  const heatStressRisk =
    typeof tMax === 'number' ? tMax >= 30 || tNow >= 28 : typeof tNow === 'number' ? tNow >= 28 : false
  const evaporationRisk =
    typeof tNow === 'number' && typeof windKph === 'number' && typeof humidity === 'number'
      ? tNow >= 28 && windKph >= 15 && humidity <= 65
      : false

  if (frostRisk) {
    const expectedHours =
      typeof firstBelow2CInHours === 'number'
        ? Math.max(0, Math.round(firstBelow2CInHours))
        : 12

    const dropSeverity =
      typeof next48hMinTempC === 'number' ? Math.max(0, frostThresholdC - next48hMinTempC) : 0

    const actionPlan = t
      ? expectedHours <= 6
        ? dropSeverity >= 1.5
          ? t('common.smartAlertFallback.frost.actionPlan.immediate')
          : t('common.smartAlertFallback.frost.actionPlan.earlyIrrigation')
        : t('common.smartAlertFallback.frost.actionPlan.prepareCovers')
      : 'Prepare row covers/thermal blankets now, keep soil mulched, and monitor plants during the first sub-2°C hours.'

    const headlineTemplate = t ? t('common.criticalFrost') : 'CRITICAL: Frost expected in X hours. Cover your sensitive plants!'
    const localizedHeadline = headlineTemplate.replace('X', String(expectedHours))

    return {
      riskType: 'frost',
      isCritical: true,
      headline: localizedHeadline,
      recommendedAction: t
        ? t('common.smartAlertFallback.frost.recommendedAction')
        : 'Before sunset, cover vulnerable seedlings with row cover or breathable mulch. Keep soil covered and avoid heavy watering right before freezing.',
      actionPlan,
      details: t ? t('common.smartAlertFallback.frost.details') : `Signals: next48h min ${toFixedOrDash(next48hMinTempC, 1)}C; now ${toFixedOrDash(tNow, 1)}C.`,
      tags: t ? t('common.smartAlertFallback.frost.tags') : ['Frost', 'Seedlings', 'Mulch', 'Protect'],
    }
  }

  if (heavyRainRisk) {
    return {
      riskType: 'heavy-rain',
      isCritical: false,
      headline: t ? t('common.smartAlertFallback.heavy-rain.headline') : 'Heavy rain risk — reduce runoff and protect topsoil!',
      recommendedAction: t
        ? t('common.smartAlertFallback.heavy-rain.recommendedAction')
        : 'Ensure ground cover is in place (mulch/cover crops). If possible, add compost and use berms/swales to slow water and reduce erosion.',
      details: t ? t('common.smartAlertFallback.heavy-rain.details') : `Signals: precipitation sum ${toFixedOrDash(precipSumMm, 0)} mm.`,
      actionPlan: t
        ? t('common.smartAlertFallback.heavy-rain.actionPlan')
        : 'Re-check drainage paths and ensure mulch/cover crop contact with the soil to reduce erosion.',
      tags: t ? t('common.smartAlertFallback.heavy-rain.tags') : ['Rain', 'Erosion', 'Ground cover'],
    }
  }

  if (heatStressRisk) {
    return {
      riskType: 'heat-stress',
      isCritical: false,
      headline: t ? t('common.smartAlertFallback.heat-stress.headline') : 'Heat stress risk — keep roots cool and soils covered!',
      recommendedAction: t
        ? t('common.smartAlertFallback.heat-stress.recommendedAction')
        : 'Maintain soil cover (mulch/cover crops) and irrigate early/late to reduce stress. Use compost and organic matter to improve water-holding capacity.',
      details: t ? t('common.smartAlertFallback.heat-stress.details') : `Signals: max ${toFixedOrDash(tMax, 1)}C, now ${toFixedOrDash(tNow, 1)}C.`,
      actionPlan: t
        ? t('common.smartAlertFallback.heat-stress.actionPlan')
        : 'Mulch heavier if beds dry quickly, and plan irrigation earlier when temperatures are lower.',
      tags: t ? t('common.smartAlertFallback.heat-stress.tags') : ['Heat', 'Soil cover', 'Moisture'],
    }
  }

  if (evaporationRisk) {
    return {
      riskType: 'high-evaporation',
      isCritical: false,
      headline: t ? t('common.smartAlertFallback.high-evaporation.headline') : 'High evaporation risk today — mulch your soil!',
      recommendedAction: t
        ? t('common.smartAlertFallback.high-evaporation.recommendedAction')
        : 'Apply a thick mulch layer (straw/leaf mold) to reduce evaporation. Water more deeply and less frequently, and prioritize soil cover over bare ground.',
      details: t
        ? t('common.smartAlertFallback.high-evaporation.details')
        : `Signals: now ${toFixedOrDash(tNow, 1)}C, wind ${toFixedOrDash(windKph, 0)} kph, humidity ${toFixedOrDash(humidity, 0)}%.`,
      actionPlan: t
        ? t('common.smartAlertFallback.high-evaporation.actionPlan')
        : 'Refresh mulch if it thins and water deeply early/late to reduce evaporation.',
      tags: t ? t('common.smartAlertFallback.high-evaporation.tags') : ['Evaporation', 'Mulch', 'Moisture'],
    }
  }

  return {
    riskType: 'general',
    isCritical: false,
    headline: t ? t('common.smartAlertFallback.general.headline') : 'Stable conditions — focus on soil cover and biology',
    recommendedAction: t
      ? t('common.smartAlertFallback.general.recommendedAction')
      : 'Keep the soil covered, avoid unnecessary tillage, and feed the soil food web with compost and organic inputs.',
    details: t ? t('common.smartAlertFallback.general.details') : `Signals: min ${toFixedOrDash(tMin, 1)}C / max ${toFixedOrDash(tMax, 1)}C; precip ${toFixedOrDash(
        precipSumMm,
        0
      )} mm.`,
    actionPlan: t
      ? t('common.smartAlertFallback.general.actionPlan')
      : 'Maintain consistent ground cover and schedule your next soil/plant check when conditions shift.',
    tags: t ? t('common.smartAlertFallback.general.tags') : ['Soil health', 'Mulch', 'Compost'],
  }
}

function smartAlertLegacyToUiModel(legacy) {
  const recommendedAction = legacy?.recommendedAction
  const actionPlan = legacy?.actionPlan
  const instruction = [recommendedAction, actionPlan].filter((x) => typeof x === 'string' && x.trim().length)

  return {
    status: typeof legacy?.headline === 'string' && legacy.headline.trim() ? legacy.headline : null,
    reason: typeof legacy?.details === 'string' && legacy.details.trim() ? legacy.details : null,
    instruction,
    riskType: legacy?.riskType || 'unknown',
    isCritical: Boolean(legacy?.isCritical),
    tags: Array.isArray(legacy?.tags) ? legacy.tags : [],
  }
}

function weatherSignalsFingerprint(signals) {
  if (!signals || typeof signals !== 'object') return 'null'
  const parts = [
    typeof signals?.tempNowC === 'number' ? signals.tempNowC.toFixed(1) : '—',
    typeof signals?.humidityNowPct === 'number' ? Math.round(signals.humidityNowPct) : '—',
    typeof signals?.windKph === 'number' ? Math.round(signals.windKph) : '—',
    typeof signals?.precipitationSumMm === 'number' ? Math.round(signals.precipitationSumMm) : '—',
    typeof signals?.tempMinC === 'number' ? signals.tempMinC.toFixed(1) : '—',
    typeof signals?.tempMaxC === 'number' ? signals.tempMaxC.toFixed(1) : '—',
    typeof signals?.next48hMinTempC === 'number' ? signals.next48hMinTempC.toFixed(1) : '—',
    typeof signals?.firstBelow2CInHours === 'number' ? Math.round(signals.firstBelow2CInHours) : '—',
    typeof signals?.weatherCode === 'number' ? signals.weatherCode : '—',
  ]
  return parts.join('|')
}

function buildDailyTasksFallback(signals, t) {
  const temp = signals?.tempNowC
  const humidity = signals?.humidityNowPct
  const precip = signals?.precipitationSumMm
  const tMin = signals?.tempMinC

  const frostRisk = typeof tMin === 'number' ? tMin <= 1.5 : false
  const hasRain = typeof precip === 'number' ? precip >= 6 : false
  const highHumidity = typeof humidity === 'number' ? humidity >= 70 : false
  const heat = typeof temp === 'number' ? temp >= 28 : false

  if (frostRisk) {
    return [
      {
        id: 'protect-seedlings',
        title: t ? t('dashboard.fallbackTasks.protect-seedlings.title') : 'Protect young seedlings tonight',
        whyThisTaskHelps: t
          ? t('dashboard.fallbackTasks.protect-seedlings.whyThisTaskHelps')
          : 'Minimizes freeze stress and helps preserve tender growth.',
        steps: [
          ...(t ? t('dashboard.fallbackTasks.protect-seedlings.steps') : []),
        ],
        estimatedMinutes: 20,
      },
      {
        id: 'soil-cover-frost',
        title: t ? t('dashboard.fallbackTasks.soil-cover-frost.title') : 'Re-check soil cover (mulch/compost)',
        whyThisTaskHelps: t
          ? t('dashboard.fallbackTasks.soil-cover-frost.whyThisTaskHelps')
          : 'Soil cover buffers temperature swings and supports soil biology.',
        steps: [
          ...(t ? t('dashboard.fallbackTasks.soil-cover-frost.steps') : []),
        ],
        estimatedMinutes: 10,
      },
      {
        id: 'pest-check-frost',
        title: t ? t('dashboard.fallbackTasks.pest-check-frost.title') : 'Quick pest/disease check',
        whyThisTaskHelps: t
          ? t('dashboard.fallbackTasks.pest-check-frost.whyThisTaskHelps')
          : 'Early detection improves recovery and reduces spread.',
        steps: [...(t ? t('dashboard.fallbackTasks.pest-check-frost.steps') : [])],
        estimatedMinutes: 15,
      },
    ]
  }

  if (heat && !frostRisk) {
    return [
      {
        id: 'water-early',
        title: t ? t('dashboard.fallbackTasks.water-early.title') : 'Water early (deep, not frequent)',
        whyThisTaskHelps: t
          ? t('dashboard.fallbackTasks.water-early.whyThisTaskHelps')
          : 'Reduces evaporation while keeping roots supplied.',
        steps: [
          ...(t ? t('dashboard.fallbackTasks.water-early.steps') : []),
        ],
        estimatedMinutes: 25,
      },
      {
        id: 'mulch-heat',
        title: t ? t('dashboard.fallbackTasks.mulch-heat.title') : 'Apply/refresh soil mulch',
        whyThisTaskHelps: t
          ? t('dashboard.fallbackTasks.mulch-heat.whyThisTaskHelps')
          : 'Maintains moisture and improves microbial activity.',
        steps: [...(t ? t('dashboard.fallbackTasks.mulch-heat.steps') : [])],
        estimatedMinutes: 20,
      },
      {
        id: 'pest-check-heat',
        title: t ? t('dashboard.fallbackTasks.pest-check-heat.title') : 'Check for heat-stress pests',
        whyThisTaskHelps: t
          ? t('dashboard.fallbackTasks.pest-check-heat.whyThisTaskHelps')
          : 'Stress can increase susceptibility to pests and leaf damage.',
        steps: [...(t ? t('dashboard.fallbackTasks.pest-check-heat.steps') : [])],
        estimatedMinutes: 15,
      },
    ]
  }

  if (hasRain || highHumidity) {
    return [
      {
        id: 'mulch-soil',
        title: t ? t('dashboard.fallbackTasks.mulch-soil.title') : 'Mulch the soil',
        whyThisTaskHelps: t
          ? t('dashboard.fallbackTasks.mulch-soil.whyThisTaskHelps')
          : 'Locks in moisture from recent rainfall and supports microbes.',
        steps: [...(t ? t('dashboard.fallbackTasks.mulch-soil.steps') : [])],
        estimatedMinutes: 20,
      },
      {
        id: 'compost-topdress',
        title: t ? t('dashboard.fallbackTasks.compost-topdress.title') : 'Top-dress with compost',
        whyThisTaskHelps: t
          ? t('dashboard.fallbackTasks.compost-topdress.whyThisTaskHelps')
          : 'Adds organic matter that feeds soil biology and builds organic carbon.',
        steps: [...(t ? t('dashboard.fallbackTasks.compost-topdress.steps') : [])],
        estimatedMinutes: 15,
      },
      {
        id: 'pest-check-rain',
        title: t ? t('dashboard.fallbackTasks.pest-check-rain.title') : 'Check for pests (quick scout)',
        whyThisTaskHelps: t
          ? t('dashboard.fallbackTasks.pest-check-rain.whyThisTaskHelps')
          : 'Helps you address issues before they spread.',
        steps: [...(t ? t('dashboard.fallbackTasks.pest-check-rain.steps') : [])],
        estimatedMinutes: 10,
      },
    ]
  }

  // Dry/default.
  return [
    {
      id: 'moisture-check',
      title: t ? t('dashboard.fallbackTasks.moisture-check.title') : 'Check soil moisture and water deeply if needed',
      whyThisTaskHelps: t
        ? t('dashboard.fallbackTasks.moisture-check.whyThisTaskHelps')
        : 'Prevents drying stress and supports microbial breakdown.',
      steps: [...(t ? t('dashboard.fallbackTasks.moisture-check.steps') : [])],
      estimatedMinutes: 15,
    },
    {
      id: 'soil-cover-dry',
      title: t ? t('dashboard.fallbackTasks.soil-cover-dry.title') : 'Re-establish ground cover',
      whyThisTaskHelps: t
        ? t('dashboard.fallbackTasks.soil-cover-dry.whyThisTaskHelps')
        : 'Reduces erosion and helps organic matter stay in place.',
      steps: [...(t ? t('dashboard.fallbackTasks.soil-cover-dry.steps') : [])],
      estimatedMinutes: 20,
    },
    {
      id: 'pest-check-dry',
      title: t ? t('dashboard.fallbackTasks.pest-check-dry.title') : 'Check for pests and early disease signs',
      whyThisTaskHelps: t
        ? t('dashboard.fallbackTasks.pest-check-dry.whyThisTaskHelps')
        : 'Early detection improves recovery and reduces losses.',
      steps: [...(t ? t('dashboard.fallbackTasks.pest-check-dry.steps') : [])],
      estimatedMinutes: 12,
    },
  ]
}

async function fetchOpenMeteoSignals(latitude, longitude, { correlationId } = {}) {
  const t0 = performance.now()
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(
    latitude
  )}&longitude=${encodeURIComponent(
    longitude
  )}&current=temperature_2m,relative_humidity_2m,dew_point_2m,precipitation,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&hourly=temperature_2m,dew_point_2m&forecast_hours=48&past_days=1&forecast_days=2&timezone=auto`

  weatherLog.info('weather.openMeteo.request.start', { correlationId })
  let res
  try {
    res = await fetch(url)
  } catch (err) {
    weatherLog.error(
      'weather.openMeteo.request.error',
      { ...normalizeErrorForLog(err), phase: 'fetch' },
      { correlationId, durationMs: performance.now() - t0 }
    )
    throw err
  }

  if (!res.ok) {
    weatherLog.warn(
      'weather.openMeteo.request.error',
      { httpStatus: res.status, phase: 'http' },
      { correlationId, durationMs: performance.now() - t0 }
    )
    throw new Error(`Weather request failed: HTTP ${res.status}`)
  }

  const data = await res.json()

  const current = data?.current || {}
  const daily = data?.daily || {}

  const tempNowC = typeof current.temperature_2m === 'number' ? current.temperature_2m : null
  const humidityNowPct =
    typeof current.relative_humidity_2m === 'number' ? current.relative_humidity_2m : null
  const dewPointNowC =
    typeof current.dew_point_2m === 'number' ? current.dew_point_2m : null
  const windKph = typeof current.wind_speed_10m === 'number' ? current.wind_speed_10m : null
  const precipNowMm = typeof current.precipitation === 'number' ? current.precipitation : null

  const tempMaxC =
    Array.isArray(daily.temperature_2m_max) && daily.temperature_2m_max.length
      ? daily.temperature_2m_max[0]
      : null
  const tempMinC =
    Array.isArray(daily.temperature_2m_min) && daily.temperature_2m_min.length
      ? daily.temperature_2m_min[0]
      : null
  const precipitationSumMm =
    Array.isArray(daily.precipitation_sum) && daily.precipitation_sum.length
      ? daily.precipitation_sum[0]
      : null
  const precipitationYesterdayMm =
    Array.isArray(daily.precipitation_sum) && daily.precipitation_sum.length > 1
      ? daily.precipitation_sum[1]
      : null

  const hourly = data?.hourly || {}
  const hourlyTime = Array.isArray(hourly.time) ? hourly.time : []
  const hourlyTempC = Array.isArray(hourly.temperature_2m) ? hourly.temperature_2m : []
  const hourlyDewPointC = Array.isArray(hourly.dew_point_2m) ? hourly.dew_point_2m : []

  const forecastLen = Math.min(hourlyTime.length, hourlyTempC.length, hourlyDewPointC.length)
  const next48hTime = forecastLen ? hourlyTime.slice(0, forecastLen) : []
  const next48hTempC = forecastLen ? hourlyTempC.slice(0, forecastLen) : []
  const next48hDewPointC = forecastLen ? hourlyDewPointC.slice(0, forecastLen) : []

  // Precompute frost threshold crossings for deterministic fallback.
  const frostThresholdC = 2.0
  const nowTs = (() => {
    const currentTimeStr = typeof current.time === 'string' ? current.time : null
    if (!currentTimeStr) return Date.now()
    const ts = new Date(currentTimeStr).getTime()
    return Number.isFinite(ts) ? ts : Date.now()
  })()

  let next48hMinTempC = null
  for (const t of next48hTempC) {
    if (typeof t !== 'number') continue
    if (next48hMinTempC == null) next48hMinTempC = t
    else next48hMinTempC = Math.min(next48hMinTempC, t)
  }

  let firstBelow2CInHours = null
  for (let i = 0; i < next48hTempC.length; i++) {
    const t = next48hTempC[i]
    const timeStr = next48hTime[i]
    if (typeof t !== 'number' || t >= frostThresholdC) continue
    const ts = new Date(timeStr).getTime()
    if (!Number.isFinite(ts)) continue
    firstBelow2CInHours = (ts - nowTs) / (1000 * 60 * 60)
    break
  }

  const humidityBucket =
    typeof humidityNowPct === 'number'
      ? humidityNowPct < 40
        ? 'low'
        : humidityNowPct < 70
          ? 'mid'
          : 'high'
      : 'unknown'
  const sunBucket =
    typeof tempNowC === 'number'
      ? tempNowC < 15
        ? 'cool'
        : tempNowC <= 28
          ? 'warm'
          : 'hot'
      : 'unknown'

  weatherLog.info(
    'weather.openMeteo.request.complete',
    {
      httpStatus: res.status,
      hoursFetched: forecastLen,
      minTempWindowC: next48hMinTempC,
      frostRisk48h:
        (typeof firstBelow2CInHours === 'number' ? firstBelow2CInHours <= 48 : false) ||
        (typeof next48hMinTempC === 'number' ? next48hMinTempC < frostThresholdC : false),
      humidityBucket,
      sunBucket,
    },
    { correlationId, durationMs: performance.now() - t0 }
  )

  return {
    tempNowC,
    humidityNowPct,
    dewPointNowC,
    windKph,
    precipNowMm,
    tempMaxC,
    tempMinC,
    precipitationSumMm,
    precipitationYesterdayMm,
    weatherCode: current.weather_code ?? null,
    frostThresholdC,
    next48hMinTempC,
    firstBelow2CInHours,
    humidityBucket,
    sunBucket,
    next48hHourly: {
      time: next48hTime,
      temperature2mC: next48hTempC,
      dewPoint2mC: next48hDewPointC,
    },
  }
}

function deriveClimateZoneHintFromWeatherSignals(signals) {
  // Heuristic "climate zone" hint for the Soil Health Advisor.
  // (We don't store a formal Köppen classification in this app, but we can still tailor guidance
  // based on moisture + temperature patterns from recent local weather.)
  const humidityBucket = signals?.humidityBucket
  const sunBucket = signals?.sunBucket
  const precipSumMm =
    typeof signals?.precipitationSumMm === 'number' && Number.isFinite(signals.precipitationSumMm)
      ? signals.precipitationSumMm
      : null
  const tempNowC = typeof signals?.tempNowC === 'number' && Number.isFinite(signals.tempNowC) ? signals.tempNowC : null

  const frostRisk48h =
    typeof signals?.firstBelow2CInHours === 'number'
      ? signals.firstBelow2CInHours <= 48
      : typeof signals?.next48hMinTempC === 'number'
        ? signals.next48hMinTempC < signals.frostThresholdC
        : false

  if (frostRisk48h) return 'Cold (frost risk)'

  const likelyDry = humidityBucket === 'low' || (precipSumMm != null ? precipSumMm < 5 : false)
  const likelyWet = humidityBucket === 'high' || (precipSumMm != null ? precipSumMm >= 10 : false)

  if (likelyDry) return sunBucket === 'hot' ? 'Dry & Hot' : sunBucket === 'warm' ? 'Dry & Warm' : 'Dry'
  if (likelyWet) return 'Humid / Wet'
  if (tempNowC != null && tempNowC <= 12) return 'Cool'
  return 'Temperate'
}

export default function SoilSenseApp() {
  const { lang, changeLanguage: i18nChangeLanguage, t } = useI18n()
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false)

  const languageMenuItems = useMemo(
    () => [
      { code: 'tr', label: 'Turkish' },
      { code: 'en', label: 'English' },
      { code: 'es', label: 'Spanish' },
      { code: 'de', label: 'German' },
      { code: 'zh', label: 'Chinese' },
    ],
    []
  )

  function changeLanguage(code) {
    i18nChangeLanguage(code)
  }

  function tl(key, fallback) {
    const value = t(key)
    return value === key ? fallback : value
  }

  const TABS = useMemo(
    () => [
      { id: 'dashboard', label: tl('tabs.dashboard', 'Dashboard'), icon: TreePine },
      { id: 'planner', label: tl('tabs.planner', 'Planner'), icon: Map },
      { id: 'compost', label: tl('tabs.compost', 'Compost'), icon: Leaf },
      { id: 'guide', label: tl('tabs.guide', 'Guide'), icon: BookOpen },
      { id: 'scan', label: tl('tabs.scan', 'Scan'), icon: Camera },
    ],
    // t() changes when the language changes.
    [lang, t]
  )

  const [activeTab, setActiveTab] = useState('dashboard')

  // Task 3: Geolocation (more robust + user retry).
  const [geoStatus, setGeoStatus] = useState('idle') // idle|loading|success|error
  const [coords, setCoords] = useState(null) // { latitude, longitude, accuracy }
  const [geoError, setGeoError] = useState('')

  // Task 6: Knowledge Hub
  const [hubStatus, setHubStatus] = useState('idle') // idle|loading|success|error
  const [hubError, setHubError] = useState('')
  const [knowledgeHub, setKnowledgeHub] = useState(null)
  const didRequestHubRef = useRef(false)

  // Soil advice card (Gemini).
  const [aiStatus, setAiStatus] = useState('idle') // idle|loading|success|error
  const [aiAdvice, setAiAdvice] = useState('')
  const [aiError, setAiError] = useState('')
  const lastAdviceCoordsKeyRef = useRef('')

  // Smart Alert card (weather + user biological/activity signals via a deterministic engine).
  const [smartStatus, setSmartStatus] = useState('idle') // idle|loading|success|error
  const [smartError, setSmartError] = useState('')
  const [smartWeatherSignals, setSmartWeatherSignals] = useState(null)
  const [locationIntel, setLocationIntel] = useState(null)
  const [plantScanResult, setPlantScanResult] = useState(null)
  const lastAlertCoordsKeyRef = useRef('')
  const lastSmartWeatherFingerprintRef = useRef('')
  const smartWeatherFetchInFlightRef = useRef(false)
  const smartWeatherLastFetchAtRef = useRef(0)
  const SMART_WEATHER_REFRESH_MS = 10 * 60 * 1000 // keep alert “alive” without excessive API calls

  // Task 7 (UI upgrade): Soil Vitality Score (0-100)
  const [vitalityStatus, setVitalityStatus] = useState('idle') // idle|loading|success|error
  const [vitalityError, setVitalityError] = useState('')
  const [vitalityScore, setVitalityScore] = useState(null)
  const [vitalityExplanation, setVitalityExplanation] = useState('')
  const [vitalityBaseScore, setVitalityBaseScore] = useState(null)
  const [vitalityBaseExplanation, setVitalityBaseExplanation] = useState('')

  // Task 10 (Sustainability): Green Score & badge.
  const GREEN_SCORE_KEY = 'soilsense.greenScore'
  const GREEN_LEVELS = useMemo(
    () => [
      { name: t('dashboard.levelSeedling'), min: 0, max: 19, nextAt: 20 },
      { name: t('dashboard.levelSprout'), min: 20, max: 49, nextAt: 50 },
      { name: t('dashboard.levelGuardian'), min: 50, max: 1e9, nextAt: null },
    ],
    [t]
  )

  const [greenScore, setGreenScore] = useState(() => {
    try {
      const raw = localStorage.getItem(GREEN_SCORE_KEY)
      const n = raw ? Number(raw) : 0
      return Number.isFinite(n) ? n : 0
    } catch {
      return 0
    }
  })
  const awardedPointEventsRef = useRef(new Set())

  useEffect(() => {
    try {
      const raw = localStorage.getItem(GREEN_POINT_EVENTS_KEY)
      const arr = raw ? JSON.parse(raw) : []
      if (Array.isArray(arr)) {
        awardedPointEventsRef.current = new Set(arr.filter((x) => typeof x === 'string'))
      }
    } catch {
      awardedPointEventsRef.current = new Set()
    }
  }, [])

  function addGreenPoints(points) {
    const delta = Number(points)
    if (!Number.isFinite(delta) || delta <= 0) return
    setGreenScore((prev) => {
      const next = prev + delta
      try {
        const payload = String(next)
        localStorage.setItem(GREEN_SCORE_KEY, payload)
        storageLog.info('storage.write', { key: GREEN_SCORE_KEY, bytes: payload.length })
      } catch (err) {
        storageLog.warn('storage.write.failed', { key: GREEN_SCORE_KEY, ...normalizeErrorForLog(err) })
      }
      return next
    })
  }

  function addGreenPointsOnce(eventKey, points) {
    const key = typeof eventKey === 'string' ? eventKey.trim() : ''
    if (!key) {
      addGreenPoints(points)
      return
    }
    if (awardedPointEventsRef.current.has(key)) return
    awardedPointEventsRef.current.add(key)
    try {
      localStorage.setItem(
        GREEN_POINT_EVENTS_KEY,
        JSON.stringify(Array.from(awardedPointEventsRef.current))
      )
    } catch {
      // ignore persistence failure; scoring still remains guarded in-memory
    }
    addGreenPoints(points)
  }

  // Task 11 (Daily tasks): generated once per day.
  const getTodayKey = () => {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const [dailyTasksDayKey, setDailyTasksDayKey] = useState(getTodayKey())
  const [dailyTasksStatus, setDailyTasksStatus] = useState('idle') // idle|loading|success|error
  const [dailyTasksError, setDailyTasksError] = useState('')
  const [dailyTasks, setDailyTasks] = useState([]) // { id,title,whyThisTaskHelps,steps,estimatedMinutes }
  const [completedTaskIds, setCompletedTaskIds] = useState([]) // persisted per day
  const dailyTasksGenerationInFlightRef = useRef(false)
  const forceDailyTasksRefreshRef = useRef(false)

  // Profile + Activity system
  const [profileOpen, setProfileOpen] = useState(false)
  const [profile, setProfile] = useState(() => normalizeProfile(loadProfile()))
  const [addressDraft, setAddressDraft] = useState(() => normalizeProfile(loadProfile()).address || '')
  const [soilTypeDraft, setSoilTypeDraft] = useState(() => normalizeProfile(loadProfile()).soilType)
  const [fieldSizeDraft, setFieldSizeDraft] = useState(() => {
    const p = normalizeProfile(loadProfile())
    return typeof p.fieldSize?.value === 'number' ? String(p.fieldSize.value) : ''
  })
  const [fieldSizeUnitDraft, setFieldSizeUnitDraft] = useState(() => {
    const p = normalizeProfile(loadProfile())
    return p.fieldSize?.unit || 'ha'
  })
  const [workforceDraft, setWorkforceDraft] = useState(() => {
    const p = normalizeProfile(loadProfile())
    return typeof p.workforce === 'number' ? String(p.workforce) : ''
  })
  const [equipmentDraft, setEquipmentDraft] = useState(() => {
    const p = normalizeProfile(loadProfile())
    return p.equipment || { shovel: false, tractor: false, sprinkler: false, dripIrrigation: false }
  })
  const [currentCropsDraft, setCurrentCropsDraft] = useState(() => normalizeProfile(loadProfile()).currentCrops || [])
  const [activityLog, setActivityLog] = useState(() => loadActivityLog())
  const [activityPickerOpen, setActivityPickerOpen] = useState(false)
  const [activityDraftTypeId, setActivityDraftTypeId] = useState('')
  const [activityDraftQuantity, setActivityDraftQuantity] = useState('')
  const [activityDraftUnit, setActivityDraftUnit] = useState('')
  const [activityDraftPesticideKind, setActivityDraftPesticideKind] = useState('chemical')
  const [activityDraftFertilizerType, setActivityDraftFertilizerType] = useState('organic')
  const [activityDraftError, setActivityDraftError] = useState('')
  const [profileSaveNotice, setProfileSaveNotice] = useState('')

  const [compostGuideOpen, setCompostGuideOpen] = useState(false)
  const availableCrops = useMemo(() => getAvailableCrops(), [])

  const smartAlert = useMemo(() => {
    const signals = smartWeatherSignals && typeof smartWeatherSignals === 'object' ? smartWeatherSignals : {}
    const legacyBase = buildSmartAlertFallback(signals, t)
    const base = smartAlertLegacyToUiModel(legacyBase)

    // Highest priority: frost critical.
    if (base.isCritical || base.riskType === 'frost') return base

    const selectedCropIds = Array.isArray(profile?.currentCrops) ? profile.currentCrops : []
    const selectedCrops = selectedCropIds.map((id) => ({ id, name: t(`crops.${id}`) }))
    if (selectedCrops.length) {
      const cropNames = selectedCrops.map((x) => x.name).join(', ')
      return {
        ...base,
        status: `${cropNames}: ${base.status || ''}`.trim(),
        reason: `${t('fieldPlanner.cropAlignedAlert')} ${cropNames}.`,
        instruction: [
          t('fieldPlanner.dosageTitle'),
          t('fieldPlanner.spacingTitle'),
        ].filter(Boolean),
        tags: [cropNames, ...(base.tags || [])].slice(0, 4),
      }
    }

    // Biological override: plant scan suggests stress/sickness.
    const healthStatus = plantScanResult?.healthStatus
    const isBioIssue = healthStatus === 'Sick' || healthStatus === 'Stressed'
    if (isBioIssue) {
      const pestKey =
        legacyBase?.riskType === 'heavy-rain'
          ? 'pest-check-rain'
          : legacyBase?.riskType === 'heat-stress' || legacyBase?.riskType === 'high-evaporation'
            ? 'pest-check-heat'
            : 'pest-check-dry'

      const plantStatusText = t(`plantScanner.status${healthStatus}`)
      const statusTitle = t(`dashboard.fallbackTasks.${pestKey}.title`)
      const whyThisTaskHelps = t(`dashboard.fallbackTasks.${pestKey}.whyThisTaskHelps`)
      const steps = t(`dashboard.fallbackTasks.${pestKey}.steps`)

      return {
        status: statusTitle,
        reason: `${plantStatusText}. ${whyThisTaskHelps}`,
        instruction: Array.isArray(steps) ? steps.slice(0, 4) : [],
        riskType: 'biological',
        isCritical: false,
        tags: [plantStatusText].filter(Boolean),
      }
    }

    // Manual logs override: chemical inputs -> recovery monitoring; organic inputs -> moisture monitoring.
    const nowTs = Date.now()
    let lastOrganicTs = null
    let lastChemicalTs = null

    for (const a of activityLog) {
      const id = a?.activityTypeId
      const ts = new Date(a?.timestamp || 0).getTime()
      if (!Number.isFinite(ts)) continue

      if (id === 'added-compost' || id === 'used-organic-fertilizer') {
        lastOrganicTs = lastOrganicTs == null ? ts : Math.max(lastOrganicTs, ts)
        continue
      }

      if (id === 'fertilizer-application') {
        const meta = a?.meta && typeof a.meta === 'object' ? a.meta : {}
        const fertilizerType = meta?.fertilizerType || 'organic'
        if (fertilizerType === 'organic') {
          lastOrganicTs = lastOrganicTs == null ? ts : Math.max(lastOrganicTs, ts)
        } else {
          lastChemicalTs = lastChemicalTs == null ? ts : Math.max(lastChemicalTs, ts)
        }
        continue
      }

      if (id === 'pesticide-application') {
        const meta = a?.meta && typeof a.meta === 'object' ? a.meta : {}
        const pesticideKind = meta?.pesticideKind || 'chemical'
        if (pesticideKind === 'chemical') {
          lastChemicalTs = lastChemicalTs == null ? ts : Math.max(lastChemicalTs, ts)
        }
      }
    }

    const organicRecentlyAdded = typeof lastOrganicTs === 'number' && nowTs - lastOrganicTs <= 48 * 60 * 60 * 1000
    const chemicalRecentlyApplied =
      typeof lastChemicalTs === 'number' && nowTs - lastChemicalTs <= 72 * 60 * 60 * 1000

    if (chemicalRecentlyApplied) {
      const pestKey =
        legacyBase?.riskType === 'heavy-rain'
          ? 'pest-check-rain'
          : legacyBase?.riskType === 'heat-stress' || legacyBase?.riskType === 'high-evaporation'
            ? 'pest-check-heat'
            : 'pest-check-dry'

      const statusTitle = t(`dashboard.fallbackTasks.${pestKey}.title`)
      const whyThisTaskHelps = t(`dashboard.fallbackTasks.${pestKey}.whyThisTaskHelps`)
      const steps = t(`dashboard.fallbackTasks.${pestKey}.steps`)
      const instruction = Array.isArray(steps) ? steps.slice(0, 4) : []

      return {
        ...base,
        status: statusTitle,
        reason: whyThisTaskHelps,
        instruction,
        riskType: 'biological',
        tags: [statusTitle],
      }
    }

    if (organicRecentlyAdded) {
      const moistureSteps = t('dashboard.fallbackTasks.moisture-check.steps')
      const moistureBullets = Array.isArray(moistureSteps) ? moistureSteps.slice(0, 2) : []
      const actionPlanBullet = base.instruction?.[1] || null
      const instruction = [ ...moistureBullets, actionPlanBullet ].filter(
        (x) => typeof x === 'string' && x.trim().length > 0
      )

      return {
        ...base,
        reason: t('dashboard.fallbackTasks.moisture-check.whyThisTaskHelps'),
        instruction,
      }
    }

    // Profile calibration (soil type): adjust “general/stable” guidance toward realistic constraints.
    const soilType = profile?.soilType || 'loam'
    if (base.riskType === 'general' && soilType === 'sandy') {
      const moistureSteps = t('dashboard.fallbackTasks.moisture-check.steps')
      const instruction = Array.isArray(moistureSteps) ? moistureSteps.slice(0, 4) : []
      return {
        ...base,
        status: t('dashboard.fallbackTasks.moisture-check.title'),
        reason: t('dashboard.fallbackTasks.moisture-check.whyThisTaskHelps'),
        instruction,
        tags: [t('dashboard.fallbackTasks.moisture-check.title')],
      }
    }

    if (base.riskType === 'general' && soilType === 'clay') {
      const coverSteps = t('dashboard.fallbackTasks.soil-cover-dry.steps')
      const instruction = Array.isArray(coverSteps) ? coverSteps.slice(0, 4) : []
      return {
        ...base,
        status: t('dashboard.fallbackTasks.soil-cover-dry.title'),
        reason: t('dashboard.fallbackTasks.soil-cover-dry.whyThisTaskHelps'),
        instruction,
        tags: [t('dashboard.fallbackTasks.soil-cover-dry.title')],
      }
    }

    return base
  }, [smartWeatherSignals, activityLog, plantScanResult, t, lang, profile])

  const refreshCycleKeyRef = useRef('')
  const runIdRef = useRef(null)

  function ensureRunId() {
    const coordPart =
      coords && typeof coords.latitude === 'number' && typeof coords.longitude === 'number'
        ? coordsKey(coords)
        : 'no-coords'
    const key = `${coordPart}|${lang}`
    if (refreshCycleKeyRef.current !== key) {
      refreshCycleKeyRef.current = key
      runIdRef.current = generateRunId()
    }
    return runIdRef.current
  }

  function loadDailyTasksForDay(dayKey) {
    try {
      const tasksRaw = localStorage.getItem(`soilsense.dailyTasks.${dayKey}`)
      const doneRaw = localStorage.getItem(
        `soilsense.dailyTasksCompleted.${dayKey}`
      )
      const tasks = tasksRaw ? JSON.parse(tasksRaw) : null
      const done = doneRaw ? JSON.parse(doneRaw) : null
      return {
        tasks: Array.isArray(tasks) ? tasks : [],
        completed: Array.isArray(done) ? done : [],
      }
    } catch {
      return { tasks: [], completed: [] }
    }
  }

  useEffect(() => {
    const syncDayKey = () => setDailyTasksDayKey(getTodayKey())
    const timer = window.setInterval(syncDayKey, 60 * 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const loaded = loadDailyTasksForDay(dailyTasksDayKey)
    if (loaded.tasks.length) {
      setDailyTasks(loaded.tasks)
      setCompletedTaskIds(loaded.completed)
      setDailyTasksStatus('success')
    } else {
      setDailyTasks([])
      setCompletedTaskIds(loaded.completed)
      setDailyTasksStatus('idle')
    }
  }, [dailyTasksDayKey])

  function toggleTaskCompleted(taskId) {
    const id = String(taskId)
    setCompletedTaskIds((prev) => {
      const isDone = prev.includes(id)
      const next = isDone ? prev : [...prev, id]
      try {
        const payload = JSON.stringify(next)
        localStorage.setItem(`soilsense.dailyTasksCompleted.${dailyTasksDayKey}`, payload)
        storageLog.info('storage.write', {
          key: `soilsense.dailyTasksCompleted.${dailyTasksDayKey}`,
          bytes: payload.length,
        })
      } catch (err) {
        storageLog.warn('storage.write.failed', {
          key: `soilsense.dailyTasksCompleted.${dailyTasksDayKey}`,
          ...normalizeErrorForLog(err),
        })
      }

      // Only award points the first time.
      if (!isDone) addGreenPoints(5)
      return next
    })
  }

  const recentActivities = useMemo(() => {
    const now = Date.now()
    const weekMs = 7 * 24 * 60 * 60 * 1000
    return activityLog
      .filter((a) => {
        const ts = new Date(a?.timestamp || 0).getTime()
        return Number.isFinite(ts) && now - ts <= weekMs
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }, [activityLog])

  const activityImpact = useMemo(() => {
    // Quantitative + contextual impact window.
    const now = Date.now()
    const weekMs = 7 * 24 * 60 * 60 * 1000
    const fieldAreaHa =
      profile?.fieldSize?.value && typeof profile.fieldSize.value === 'number'
        ? profile.fieldSize.unit === 'ha'
          ? profile.fieldSize.value
          : profile.fieldSize.value / 10000
        : null

    const soilType = profile?.soilType || 'loam'
    const soilTypeOrganicMultiplier = soilType === 'sandy' ? 1.15 : soilType === 'clay' ? 1.05 : 1.08

    let organicKg = 0
    let organicCount = 0
    let chemicalPesticideLiters = 0
    let chemicalPesticideCount = 0
    let chemicalFertilizerKg = 0
    let chemicalFertilizerCount = 0

    let lastOrganicTs = null
    let lastChemicalTs = null

    function toOrganicKg(quantity, unit) {
      if (typeof quantity !== 'number' || !Number.isFinite(quantity)) return 0
      if (unit === 'kg' || !unit) return quantity
      if (unit === 'bags') return quantity * 10 // reasonable default for “kg-ish” bags
      return quantity
    }

    function toPesticideDose(quantity, unit) {
      if (typeof quantity !== 'number' || !Number.isFinite(quantity)) return 0
      if (unit === 'liters' || !unit) return quantity
      if (unit === 'kg' || unit === 'g') {
        if (unit === 'g') return quantity / 1000
        return quantity
      }
      return quantity
    }

    function toFertilizerKg(quantity, unit) {
      if (typeof quantity !== 'number' || !Number.isFinite(quantity)) return 0
      if (unit === 'kg' || !unit) return quantity
      if (unit === 'bags') return quantity * 10
      return quantity
    }

    for (const act of recentActivities) {
      const ts = new Date(act?.timestamp || 0).getTime()
      if (!Number.isFinite(ts) || now - ts > weekMs) continue

      const qty = typeof act?.quantity === 'number' ? act.quantity : null
      const unit = typeof act?.unit === 'string' ? act.unit : null
      const meta = act?.meta && typeof act.meta === 'object' ? act.meta : {}

      if (act?.activityTypeId === 'added-compost' || act?.activityTypeId === 'used-organic-fertilizer') {
        const kg = toOrganicKg(qty ?? ACTIVITY_TYPES.find((x) => x.id === act.activityTypeId)?.defaultQuantity ?? 1, unit)
        organicKg += kg
        organicCount += 1
        lastOrganicTs = lastOrganicTs == null ? ts : Math.max(lastOrganicTs, ts)
      } else if (act?.activityTypeId === 'fertilizer-application') {
        const fertilizerType = meta?.fertilizerType || 'organic'
        const kg = toFertilizerKg(qty ?? 1, unit)
        if (fertilizerType === 'organic') {
          organicKg += kg
          organicCount += 1
          lastOrganicTs = lastOrganicTs == null ? ts : Math.max(lastOrganicTs, ts)
        } else {
          chemicalFertilizerKg += kg
          chemicalFertilizerCount += 1
          lastChemicalTs = lastChemicalTs == null ? ts : Math.max(lastChemicalTs, ts)
        }
      } else if (act?.activityTypeId === 'pesticide-application') {
        const pesticideKind = meta?.pesticideKind || 'chemical'
        if (pesticideKind !== 'chemical') continue
        const dose = toPesticideDose(qty ?? ACTIVITY_TYPES.find((x) => x.id === act.activityTypeId)?.defaultQuantity ?? 1, unit)
        chemicalPesticideLiters += dose
        chemicalPesticideCount += 1
        lastChemicalTs = lastChemicalTs == null ? ts : Math.max(lastChemicalTs, ts)
      } else if (act?.activityTypeId === 'added-eggshells') {
        // Minor positive effect (buffers calcium availability + slow biology support).
        organicKg += toOrganicKg(qty ?? 1, unit) * 0.05
        organicCount += 1
        lastOrganicTs = lastOrganicTs == null ? ts : Math.max(lastOrganicTs, ts)
      } else if (act?.activityTypeId === 'watered') {
        // Water supports microbial activity; keep it small vs compost/pesticides.
        organicKg += toOrganicKg(qty ?? 1, unit) * 0.01
        organicCount += 1
        lastOrganicTs = lastOrganicTs == null ? ts : Math.max(lastOrganicTs, ts)
      }
    }

    const organicDose = fieldAreaHa && fieldAreaHa > 0 ? organicKg / fieldAreaHa : organicKg
    const pesticideDose = fieldAreaHa && fieldAreaHa > 0 ? chemicalPesticideLiters / fieldAreaHa : chemicalPesticideLiters
    const chemicalFertilizerDose = fieldAreaHa && fieldAreaHa > 0 ? chemicalFertilizerKg / fieldAreaHa : chemicalFertilizerKg

    const organicDoseFactor = organicDose > 0 ? Math.log(1 + organicDose) / Math.log(1 + 5) : 0
    const pesticideDoseFactor = pesticideDose > 0 ? Math.log(1 + pesticideDose) / Math.log(1 + 5) : 0
    const chemicalFertilizerDoseFactor =
      chemicalFertilizerDose > 0 ? Math.log(1 + chemicalFertilizerDose) / Math.log(1 + 5) : 0

    const organicFreq = organicCount > 0 ? Math.min(1.4, 1 + 0.08 * Math.max(0, organicCount - 1)) : 1
    const pesticideFreq =
      chemicalPesticideCount > 0 ? Math.min(1.45, 1 + 0.1 * Math.max(0, chemicalPesticideCount - 1)) : 1
    const chemicalFertilizerFreq =
      chemicalFertilizerCount > 0 ? Math.min(1.3, 1 + 0.08 * Math.max(0, chemicalFertilizerCount - 1)) : 1

    // Soil health: compost improves structure + biology; pesticides reduce them.
    const organicSoilDelta = organicDoseFactor * organicFreq * 16 * soilTypeOrganicMultiplier
    const pesticideSoilDelta = -pesticideDoseFactor * pesticideFreq * 22
    const chemicalFertilizerSoilDelta = -chemicalFertilizerDoseFactor * chemicalFertilizerFreq * 9

    const soilHealthDelta = organicSoilDelta + pesticideSoilDelta + chemicalFertilizerSoilDelta

    // Sustainability: track “greenness” more conservatively than soil health.
    const organicSustainDelta = organicSoilDelta * 0.55
    const pesticideSustainDelta = pesticideSoilDelta * 0.7
    const chemicalFertilizerSustainDelta = chemicalFertilizerSoilDelta * 0.6
    const sustainabilityDelta = organicSustainDelta + pesticideSustainDelta + chemicalFertilizerSustainDelta

    const compostRecentlyAdded = typeof lastOrganicTs === 'number' && now - lastOrganicTs <= 48 * 60 * 60 * 1000
    const chemicalRecentlyApplied = typeof lastChemicalTs === 'number' && now - lastChemicalTs <= 72 * 60 * 60 * 1000

    const fingerprint = [
      profile?.soilType || 'loam',
      fieldAreaHa == null ? 'na' : fieldAreaHa.toFixed(2),
      `orgKg:${organicKg.toFixed(1)}`,
      `orgN:${organicCount}`,
      `pestDose:${chemicalPesticideLiters.toFixed(1)}`,
      `pestN:${chemicalPesticideCount}`,
      `chemFertKg:${chemicalFertilizerKg.toFixed(1)}`,
      `chemFertN:${chemicalFertilizerCount}`,
      `orgTs:${lastOrganicTs ? Math.round(lastOrganicTs / 60000) : 0}`,
      `chemTs:${lastChemicalTs ? Math.round(lastChemicalTs / 60000) : 0}`,
    ].join('|')

    return {
      soilHealthDelta,
      sustainabilityDelta,
      organicKg,
      organicCount,
      chemicalPesticideLiters,
      chemicalPesticideCount,
      chemicalFertilizerKg,
      chemicalFertilizerCount,
      compostRecentlyAdded,
      chemicalRecentlyApplied,
      fingerprint,
    }
  }, [activityLog, profile, recentActivities])

  const fieldPlan = useMemo(
    () =>
      buildFieldPlan({
        profile,
        climateZoneHint:
          locationIntel?.climateZone ||
          deriveClimateZoneHintFromWeatherSignals(
            smartWeatherSignals && typeof smartWeatherSignals === 'object' ? smartWeatherSignals : {}
          ),
        activityImpact,
      }),
    [profile, smartWeatherSignals, activityImpact, locationIntel]
  )

  function applyActivityImpact(baseScore) {
    if (typeof baseScore !== 'number' || !Number.isFinite(baseScore)) return baseScore
    const adjusted = Math.round(baseScore + activityImpact.soilHealthDelta)
    return Math.max(0, Math.min(100, adjusted))
  }

  const effectiveGreenScore = useMemo(() => {
    const adjusted = Math.round(greenScore + (activityImpact?.sustainabilityDelta || 0))
    return Math.max(0, Math.min(100, adjusted))
  }, [greenScore, activityImpact])

  const prevEffectiveGreenScoreRef = useRef(effectiveGreenScore)
  const shouldAnimateGreenScoreFill = effectiveGreenScore > prevEffectiveGreenScoreRef.current

  useEffect(() => {
    prevEffectiveGreenScoreRef.current = effectiveGreenScore
  }, [effectiveGreenScore])

  const greenLevel = useMemo(() => {
    const found = GREEN_LEVELS.find((l) => effectiveGreenScore >= l.min && effectiveGreenScore <= l.max)
    return found || GREEN_LEVELS[0]
  }, [GREEN_LEVELS, effectiveGreenScore])

  // Keep Soil Vitality card in sync with quantitative activity impact.
  useEffect(() => {
    if (typeof vitalityBaseScore !== 'number' || !Number.isFinite(vitalityBaseScore)) return
    setVitalityScore(applyActivityImpact(vitalityBaseScore))
    const deltaRounded = Math.round(activityImpact?.soilHealthDelta || 0)
    if (typeof vitalityBaseExplanation === 'string' && vitalityBaseExplanation.trim().length) {
      setVitalityExplanation(
        `${vitalityBaseExplanation}\n\n${t('vitality.activityImpactPrefix')} ${deltaRounded >= 0 ? '+' : ''}${deltaRounded}`
      )
    } else {
      setVitalityExplanation('')
    }
  }, [vitalityBaseScore, vitalityBaseExplanation, activityImpact, t])

  const profileFingerprint = useMemo(() => {
    const fs = profile?.fieldSize?.value
    const fu = profile?.fieldSize?.unit
    const eq = profile?.equipment || {}
    return [
      profile?.soilType || 'loam',
      typeof fs === 'number' ? fs : 'na',
      fu || 'ha',
      typeof profile?.workforce === 'number' ? profile.workforce : 'na',
      `shovel:${eq.shovel ? 1 : 0}`,
      `tractor:${eq.tractor ? 1 : 0}`,
      `sprinkler:${eq.sprinkler ? 1 : 0}`,
      `drip:${eq.dripIrrigation ? 1 : 0}`,
    ].join('|')
  }, [profile])

  const systemRecommendationContextKey = useMemo(() => {
    return `${profileFingerprint}|${activityImpact?.fingerprint || 'na'}`
  }, [profileFingerprint, activityImpact])

  // State change observer: when Activity/Profile is saved, we trigger
  // dependent recommendation engines to recalculate immediately.
  const [stateChangeSeq, setStateChangeSeq] = useState(0)
  const lastStateChangePayloadRef = useRef(null)
  const stateChangeDebounceTimerRef = useRef(null)
  const lastHandledStateChangeContextKeyRef = useRef('')

  function notifyStateChange(payload) {
    lastStateChangePayloadRef.current = payload
    setStateChangeSeq((prev) => prev + 1)
  }

  function saveProfileDraft() {
    uiLog.info('ui.modal.profile', { action: 'close', reason: 'save' })
    const fieldSizeValue =
      typeof fieldSizeDraft === 'string' && fieldSizeDraft.trim().length
        ? Number(fieldSizeDraft)
        : null
    const workforceValue =
      typeof workforceDraft === 'string' && workforceDraft.trim().length
        ? Number(workforceDraft)
        : null
    const normalizedFieldSizeValue = Number.isFinite(fieldSizeValue) ? fieldSizeValue : null
    const normalizedWorkforceValue = Number.isFinite(workforceValue) ? workforceValue : null
    const normalizedAddress = typeof addressDraft === 'string' ? addressDraft.trim() : ''
    const previousAddress = typeof profile?.address === 'string' ? profile.address.trim() : ''
    const addressChanged = normalizedAddress !== previousAddress
    const next = {
      soilType: soilTypeDraft,
      address: normalizedAddress,
      latitude:
        typeof coords?.latitude === 'number' ? coords.latitude : profile?.latitude ?? null,
      longitude:
        typeof coords?.longitude === 'number' ? coords.longitude : profile?.longitude ?? null,
      fieldSize: { value: normalizedFieldSizeValue, unit: fieldSizeUnitDraft },
      workforce: normalizedWorkforceValue,
      currentCrops: currentCropsDraft,
      equipment: equipmentDraft,
      updatedAt: new Date().toISOString(),
    }
    try {
      const payload = JSON.stringify(next)
      localStorage.setItem(PROFILE_STORAGE_KEY, payload)
      storageLog.info('storage.write', { key: PROFILE_STORAGE_KEY, bytes: payload.length })
    } catch (err) {
      storageLog.warn('storage.write.failed', { key: PROFILE_STORAGE_KEY, ...normalizeErrorForLog(err) })
    }
    setProfile(next)
    notifyStateChange({ type: 'profileSaved', updatedAt: next?.updatedAt || Date.now() })
    setProfileSaveNotice(t('profile.savedNotice'))

    if (typeof next.latitude === 'number' && typeof next.longitude === 'number') {
      setCoords((prev) => ({
        latitude: next.latitude,
        longitude: next.longitude,
        accuracy: prev?.accuracy || null,
      }))
      setGeoStatus('success')
      setGeoError('')
    }

    // Resolve/update coordinates immediately when a manual farm address is provided.
    if (normalizedAddress) {
      void requestLocation({ forceAddressLookup: addressChanged })
    }

    setProfileOpen(false)
  }

  function addActivity(activity) {
    const activityTypeId = typeof activity === 'string' ? activity : activity?.activityTypeId
    if (!activityTypeId || typeof activityTypeId !== 'string') return
    const def = ACTIVITY_TYPES.find((x) => x.id === activityTypeId)
    const quantityRaw =
      typeof activity === 'object' && activity
        ? activity.quantity
        : undefined
    const quantity =
      typeof quantityRaw === 'number'
        ? quantityRaw
        : typeof quantityRaw === 'string' && quantityRaw.trim().length
          ? Number(quantityRaw)
          : def?.defaultQuantity
    const unit =
      typeof activity === 'object' && activity
        ? activity.unit
        : undefined

    const safeQuantity = Number.isFinite(quantity) ? Math.max(0, quantity) : null
    const safeUnit = typeof unit === 'string' && unit.trim().length ? unit : def?.defaultUnit

    const meta =
      typeof activity === 'object' && activity && typeof activity.meta === 'object' ? activity.meta : {}

    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      activityTypeId,
      timestamp: new Date().toISOString(),
      quantity: safeQuantity,
      unit: safeUnit || undefined,
      meta,
    }
    setActivityLog((prev) => {
      // Guard against accidental duplicate submits (double click / rapid taps).
      const latest = prev[0]
      if (latest) {
        const latestTs = new Date(latest.timestamp || 0).getTime()
        const nowTs = Date.now()
        const sameType = latest.activityTypeId === activityTypeId
        const sameQty = Number(latest.quantity || 0) === Number(safeQuantity || 0)
        const sameUnit = String(latest.unit || '') === String(safeUnit || '')
        const sameMeta = JSON.stringify(latest.meta || {}) === JSON.stringify(meta || {})
        if (sameType && sameQty && sameUnit && sameMeta && Number.isFinite(latestTs) && nowTs - latestTs < 4000) {
          return prev
        }
      }
      const next = [entry, ...prev].slice(0, 200)
      try {
        const payload = JSON.stringify(next)
        localStorage.setItem(ACTIVITY_LOG_STORAGE_KEY, payload)
        storageLog.info('storage.write', {
          key: ACTIVITY_LOG_STORAGE_KEY,
          bytes: payload.length,
          count: next.length,
        })
      } catch (err) {
        storageLog.warn('storage.write.failed', { key: ACTIVITY_LOG_STORAGE_KEY, ...normalizeErrorForLog(err) })
      }
      return next
    })
    setActivityPickerOpen(false)
    setActivityDraftTypeId('')
    setActivityDraftQuantity('')
    setActivityDraftUnit('')
    setActivityDraftPesticideKind('chemical')
    setActivityDraftFertilizerType('organic')
    setActivityDraftError('')

    notifyStateChange({
      type: 'activitySaved',
      activityTypeId,
      timestamp: entry?.timestamp || Date.now(),
      pesticideKind: meta?.pesticideKind || null,
    })
  }

  const autoLocationRequestedRef = useRef(false)
  const locationRequestInFlightRef = useRef(false)

  // Gemini runtime API key fallback (manual testing).
  const [keyPromptOpen, setKeyPromptOpen] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [keyStatus, setKeyStatus] = useState('idle') // idle|testing|saved|error
  const [keyStatusError, setKeyStatusError] = useState('')
  const [usesRuntimeKey, setUsesRuntimeKey] = useState(() => Boolean(getRuntimeGeminiApiKey()))

  const isGeminiKeyBlocked = useMemo(() => {
    const combined = `${aiError || ''}\n${smartError || ''}`.toLowerCase()
    return (
      combined.includes('blocked') ||
      combined.includes('leaked') ||
      combined.includes('forbidden') ||
      combined.includes('403') ||
      combined.includes('expired') ||
      combined.includes('invalid')
    )
  }, [aiError, smartError])

  useEffect(() => {
    if (isGeminiKeyBlocked) {
      setKeyPromptOpen(true)
      setKeyStatus('idle')
      setKeyStatusError('')
    }
  }, [isGeminiKeyBlocked])

  const locationLine = useMemo(() => {
    if (geoStatus === 'loading') return t('common.loading')
    if (geoStatus === 'error')
      return geoError
        ? `${t('common.geolocation.locationErrorPrefix')}${geoError}`
        : t('common.geolocation.locationUnavailable')
    if (geoStatus === 'success' && coords) {
      const lat = toFixedOrDash(coords.latitude, 5)
      const lon = toFixedOrDash(coords.longitude, 5)
      return `${t('fields.fieldAddress')}: ${profile?.address || '-'} | ${t('common.geolocation.latLabel')} ${lat}, ${t('common.geolocation.lonLabel')} ${lon}`
    }
    return t('fields.locationSetupHint')
  }, [coords, geoError, geoStatus, t, profile?.address])

  async function requestLocation({ forceAddressLookup = false } = {}) {
    if (locationRequestInFlightRef.current) return
    locationRequestInFlightRef.current = true

    geoLog.info('geo.manualResolve.start', {})
    setGeoStatus('loading')
    setGeoError('')
    setVitalityStatus('idle')
    setVitalityError('')
    setVitalityScore(null)
    setVitalityExplanation('')
    try {
      const saved = loadProfile()
      const address = typeof saved?.address === 'string' ? saved.address.trim() : ''
      const savedLat = typeof saved?.latitude === 'number' ? saved.latitude : null
      const savedLon = typeof saved?.longitude === 'number' ? saved.longitude : null
      const hasSavedCoords = typeof savedLat === 'number' && typeof savedLon === 'number'

      // Highest priority: exact field coordinates already saved for this field.
      // Do not re-geocode in this case, otherwise address lookup may shift precision.
      if (hasSavedCoords && !forceAddressLookup) {
        const nextCoords = {
          latitude: savedLat,
          longitude: savedLon,
          accuracy: null,
        }
        setCoords(nextCoords)
        setGeoStatus('success')
        setGeoError('')
        return
      }

      if (address) {
        const geo = await geocodeFieldAddress(address)
        const nextCoords = {
          latitude: geo.latitude,
          longitude: geo.longitude,
          accuracy: null,
        }
        geoLog.info(
          'geo.manualResolve.success',
          {
            accuracyBucket: bucketAccuracyMeters(1000),
            ...(import.meta.env.VITE_LOG_PRECISE_LOCATION === 'true'
              ? {
                  latRounded: Number(geo.latitude).toFixed(2),
                  lonRounded: Number(geo.longitude).toFixed(2),
                }
              : {}),
          },
          {}
        )
        setCoords(nextCoords)
        setGeoStatus('success')
        setGeoError('')
        setProfile((prev) => {
          const next = {
            ...(prev || {}),
            address,
            latitude: nextCoords.latitude,
            longitude: nextCoords.longitude,
            updatedAt: new Date().toISOString(),
          }
          try {
            const payload = JSON.stringify(next)
            localStorage.setItem(PROFILE_STORAGE_KEY, payload)
            storageLog.info('storage.write', { key: PROFILE_STORAGE_KEY, bytes: payload.length })
          } catch (err) {
            storageLog.warn('storage.write.failed', { key: PROFILE_STORAGE_KEY, ...normalizeErrorForLog(err) })
          }
          return next
        })
      } else if ('geolocation' in navigator) {
        const deviceCoords = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (pos) =>
              resolve({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
              }),
            (err) => reject(err),
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
          )
        })
        const nextCoords = {
          latitude: deviceCoords.latitude,
          longitude: deviceCoords.longitude,
          accuracy: deviceCoords.accuracy,
        }
        setCoords(nextCoords)
        setGeoStatus('success')
        setGeoError('')
        setProfile((prev) => {
          const next = {
            ...(prev || {}),
            latitude: nextCoords.latitude,
            longitude: nextCoords.longitude,
            updatedAt: new Date().toISOString(),
          }
          try {
            const payload = JSON.stringify(next)
            localStorage.setItem(PROFILE_STORAGE_KEY, payload)
            storageLog.info('storage.write', { key: PROFILE_STORAGE_KEY, bytes: payload.length })
          } catch (err) {
            storageLog.warn('storage.write.failed', { key: PROFILE_STORAGE_KEY, ...normalizeErrorForLog(err) })
          }
          return next
        })
      } else {
        throw new Error(t('common.geolocation.notSupported'))
      }
    } catch (err) {
      const message = err?.message ? String(err.message) : t('common.geolocation.unknown')
      geoLog.warn('geo.manualResolve.error', { message: String(message).slice(0, 200) }, {})
      setGeoStatus('error')
      setGeoError(message)
    } finally {
      locationRequestInFlightRef.current = false
    }
  }

  async function onTestAndSaveKey() {
    const cleaned = keyDraft.trim()
    if (!cleaned) {
      setKeyStatus('error')
      setKeyStatusError(t('keyPanel.pleasePasteKeyFirst'))
      return
    }

    setKeyStatus('testing')
    setKeyStatusError('')

    try {
      await testGeminiApiKey(cleaned, { correlationId: generateRunId() })
      setRuntimeGeminiApiKey(cleaned)
      setUsesRuntimeKey(true)
      setKeyStatus('saved')
      setKeyPromptOpen(false)

      // Force rerun once key is updated.
      lastAdviceCoordsKeyRef.current = ''
      lastAlertCoordsKeyRef.current = ''
      if (coords && geoStatus === 'success') {
        void (async () => {
          const signals = await runSmartAlert()
          await runAdvice({ weatherSignalsOverride: signals })
        })()
      }

      setTimeout(() => setKeyStatus('idle'), 2000)
    } catch (err) {
      setKeyStatus('error')
      setKeyStatusError(err?.message ? err.message : String(err))
    }
  }

  useEffect(() => {
    if (autoLocationRequestedRef.current) return
    autoLocationRequestedRef.current = true

    const saved = loadProfile()
    if (saved && typeof saved.latitude === 'number' && typeof saved.longitude === 'number') {
      geoLog.info('geo.profile.cacheHit', { skippedPrompt: true }, {})
      setCoords({
        latitude: saved.latitude,
        longitude: saved.longitude,
        accuracy: null,
      })
      setGeoStatus('success')
      setGeoError('')
      return
    }
    if (typeof saved?.address === 'string' && saved.address.trim()) {
      void requestLocation()
      return
    }
    setGeoStatus('idle')
    setGeoError('')
  }, [])

  useEffect(() => {
    if (!(typeof profile?.address === 'string' && profile.address.trim())) return
    if (typeof coords?.latitude === 'number' && typeof coords?.longitude === 'number') return
    void requestLocation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.address])

  async function runAdvice({ weatherSignalsOverride, correlationId: correlationIdOverride } = {}) {
    const hasCoords =
      Boolean(coords) &&
      typeof coords?.latitude === 'number' &&
      typeof coords?.longitude === 'number'
    const hasAddress = typeof profile?.address === 'string' && profile.address.trim().length > 0
    if (!hasCoords && !hasAddress) return
    const correlationId =
      typeof correlationIdOverride === 'string' && correlationIdOverride.trim().length ? correlationIdOverride : ensureRunId()
    setAiStatus('loading')
    setAiAdvice('')
    setAiError('')

    try {
      // Reuse existing weather signals if they are fresh; otherwise fetch.
      let weatherSignals =
        weatherSignalsOverride && typeof weatherSignalsOverride === 'object' ? weatherSignalsOverride : null

      if (!weatherSignals) {
        const now = Date.now()
        const canReuse =
          smartWeatherSignals && typeof smartWeatherSignals === 'object' && now - smartWeatherLastFetchAtRef.current < SMART_WEATHER_REFRESH_MS / 2
        if (canReuse) {
          weatherSignals = smartWeatherSignals
        } else if (hasCoords) {
          try {
            weatherSignals = await fetchOpenMeteoSignals(coords.latitude, coords.longitude, { correlationId })
          } catch (err) {
            // Keep advisor UX stable even if weather signals fail.
            uiLog.debug?.('ui.soilAdvice.weatherSignals.failed', {
              message: err?.message ? String(err.message) : String(err),
            })
          }
        }
      }

      const climateZoneHint = deriveClimateZoneHintFromWeatherSignals(weatherSignals || {})
      const envIntel = await generateLocationEnvironmentalAnalysis({
        address: profile?.address || '',
        latitude: hasCoords ? coords.latitude : null,
        longitude: hasCoords ? coords.longitude : null,
        weatherSummary: weatherSignals || {},
        lang,
        correlationId,
      }).catch(() => null)
      if (envIntel && !envIntel?.parseError) setLocationIntel(envIntel)

      const locationContext = resolveFarmLocationContext({ profile, coords })
      if (!locationContext.isClear) {
        setAiAdvice(
          [
            'Location is unclear. Please provide your farm address or enable location access.',
            '',
            '- Enter your farm address in the profile to use it as the primary farm location.',
            '- If no address is available, enable device location so local weather can be fetched.',
          ].join('\n')
        )
        setAiStatus('success')
        return
      }

      const memoryBefore = loadFarmMemory(locationContext.farmKey)
      const todayEntry = {
        timestamp: new Date().toISOString(),
        weather: weatherSignals || {},
        soil: {
          score: typeof vitalityScore === 'number' ? vitalityScore : null,
          explanation: typeof vitalityExplanation === 'string' ? vitalityExplanation : '',
        },
        userActions: Array.isArray(activityLog) ? activityLog.slice(0, 25) : [],
        cropType: Array.isArray(profile?.currentCrops) ? profile.currentCrops : [],
      }
      const memoryAfter = appendFarmMemoryEntry(locationContext.farmKey, locationContext, todayEntry)

      const insight = await generateFarmDailyInsight({
        locationContext: {
          ...locationContext,
          climateZone: envIntel?.climateZone || climateZoneHint || 'unknown',
        },
        weatherSignals: weatherSignals || {},
        soilSignals: {
          soilHealthScore: typeof vitalityScore === 'number' ? vitalityScore : null,
          explanation: typeof vitalityExplanation === 'string' ? vitalityExplanation : '',
        },
        climatePatterns: {
          climateZone: envIntel?.climateZone || climateZoneHint || 'unknown',
          weatherHistoryCount: Array.isArray(memoryAfter?.entries) ? memoryAfter.entries.length : 0,
        },
        userActions: Array.isArray(activityLog) ? activityLog.slice(0, 50) : [],
        cropType: Array.isArray(profile?.currentCrops) ? profile.currentCrops : [],
        farmMemory: memoryAfter || memoryBefore || { entries: [] },
        lang,
        correlationId,
      })

      const detectedChangesFallback = buildDetectedChangesFromMemory(memoryAfter || memoryBefore)
      const normalized = {
        location_used:
          typeof insight?.location_used === 'string' && insight.location_used.trim()
            ? insight.location_used
            : locationContext.locationUsed,
        daily_summary:
          typeof insight?.daily_summary === 'string' && insight.daily_summary.trim()
            ? insight.daily_summary
            : 'Daily update generated from latest weather, soil score, and activity records.',
        detected_changes:
          typeof insight?.detected_changes === 'string' && insight.detected_changes.trim()
            ? insight.detected_changes
            : detectedChangesFallback,
        soil_health_status:
          typeof insight?.soil_health_status === 'string' && insight.soil_health_status.trim()
            ? insight.soil_health_status
            : 'Soil health is stable; continue monitoring moisture and organic matter trends.',
        recommendations: Array.isArray(insight?.recommendations)
          ? insight.recommendations.filter((x) => typeof x === 'string' && x.trim()).slice(0, 6)
          : ['Track soil moisture daily and adjust watering based on humidity trend.'],
        confidence_level:
          'high',
      }
      const cleanAdvice = [
        normalized.daily_summary,
        '',
        normalized.soil_health_status,
        '',
        normalized.detected_changes,
        '',
        ...normalized.recommendations.map((r) => `- ${r}`),
      ]
        .map((x) => String(x || '').trimEnd())
        .filter((x, i, arr) => !(x === '' && arr[i - 1] === ''))
        .join('\n')

      setAiAdvice(cleanAdvice)
      setAiStatus('success')
    } catch (err) {
      setAiStatus('error')
      setAiError(err?.message ? err.message : String(err))
    }
  }

  async function runSmartAlert({ correlationId: correlationIdOverride } = {}) {
    if (!coords) return
    const correlationId =
      typeof correlationIdOverride === 'string' && correlationIdOverride.trim().length ? correlationIdOverride : ensureRunId()
    setSmartStatus('loading')
    setSmartError('')
    setSmartWeatherSignals(null)
    setVitalityStatus('loading')
    setVitalityError('')
    setVitalityScore(null)
    setVitalityExplanation('')
    setVitalityBaseScore(null)
    setVitalityBaseExplanation('')

    let signalsForReturn = {}

    try {
      const signals = await fetchOpenMeteoSignals(coords.latitude, coords.longitude, { correlationId })
      signalsForReturn = signals && typeof signals === 'object' ? signals : {}
      const vitalityJson = await generateSoilVitalityScore({ weatherSummary: signals, lang, correlationId })
      setSmartWeatherSignals(signals)
      appendWeatherSnapshot(signals)
      lastSmartWeatherFingerprintRef.current = weatherSignalsFingerprint(signals)
      smartWeatherLastFetchAtRef.current = Date.now()
      setSmartStatus('success')

      const frostDetected =
        Boolean(
          typeof signals?.firstBelow2CInHours === 'number' ? signals.firstBelow2CInHours <= 48 : false
        ) ||
        Boolean(
          typeof signals?.next48hMinTempC === 'number' && typeof signals?.frostThresholdC === 'number'
            ? signals.next48hMinTempC < signals.frostThresholdC
            : false
        )
      uiLog.info(
        'ui.smartAlert.result',
        {
          priority: frostDetected ? 'critical' : 'normal',
          riskType: frostDetected ? 'frost' : 'weather',
          frostDetected,
          usedAi: false,
        },
        { correlationId }
      )

      if (vitalityJson?.parseError) {
        const scoreFallback = buildSoilVitalityScoreFallback(signals, lang)
        setVitalityBaseScore(scoreFallback.soilHealthScore)
        setVitalityBaseExplanation(scoreFallback.explanation)
        setVitalityScore(applyActivityImpact(scoreFallback.soilHealthScore))
        const deltaRounded = Math.round(activityImpact?.soilHealthDelta || 0)
        setVitalityExplanation(
          `${scoreFallback.explanation}\n\n${t('vitality.activityImpactPrefix')} ${
            deltaRounded >= 0 ? '+' : ''
          }${deltaRounded}`
        )
      } else {
        const score = vitalityJson?.soilHealthScore
        const explanation = vitalityJson?.explanation
        if (typeof score === 'number') {
          setVitalityBaseScore(score)
          setVitalityBaseExplanation(typeof explanation === 'string' ? explanation : '')
          setVitalityScore(applyActivityImpact(score))
        }
        if (typeof explanation === 'string' && explanation.trim()) {
          const deltaRounded = Math.round(activityImpact?.soilHealthDelta || 0)
          setVitalityExplanation(
            `${explanation}\n\n${t('vitality.activityImpactPrefix')} ${
              deltaRounded >= 0 ? '+' : ''
            }${deltaRounded}`
          )
        }
      }
      setVitalityStatus('success')

      uiLog.info(
        'ui.soilVitality.scoreSummary',
        {
          weatherHumidityBucket: signals?.humidityBucket || 'unknown',
          sunBucket: signals?.sunBucket || 'unknown',
          activityImpactDelta: Math.round(activityImpact?.soilHealthDelta || 0),
          usedGeminiFallback: Boolean(vitalityJson?.parseError),
        },
        { correlationId }
      )

      // Daily Tasks: generate once per day from current weather + vitality.
      if (
        !dailyTasksGenerationInFlightRef.current &&
        (dailyTasks.length === 0 || forceDailyTasksRefreshRef.current)
      ) {
        dailyTasksGenerationInFlightRef.current = true
        forceDailyTasksRefreshRef.current = false
        setDailyTasksStatus('loading')
        setDailyTasksError('')

        const soilScoreBase =
          vitalityJson?.parseError
            ? buildSoilVitalityScoreFallback(signals, lang).soilHealthScore
            : vitalityJson?.soilHealthScore
        const soilScoreForTasks = typeof soilScoreBase === 'number' ? applyActivityImpact(soilScoreBase) : soilScoreBase

        try {
          const dailyJson = await generateDailyTasks({
            weatherSummary: signals,
            soilHealthScore: soilScoreForTasks,
            lang,
            correlationId,
            profile,
            activityImpact,
          })

          const tasksCandidate = dailyJson?.tasks
          const cropTasks = buildCropDrivenDailyTasks(fieldPlan, t)
          const hasCropSelection = Array.isArray(profile?.currentCrops) && profile.currentCrops.length > 0
          const tasks = hasCropSelection
            ? cropTasks
            : Array.isArray(tasksCandidate) && tasksCandidate.length === 3
              ? tasksCandidate
              : buildDailyTasksFallback(signals, t)
          const taskSource = hasCropSelection
            ? 'cropPlanner'
            : Array.isArray(tasksCandidate) && tasksCandidate.length === 3
              ? 'ai'
              : 'fallback'

          setDailyTasks(tasks)
          setDailyTasksStatus('success')
          uiLog.info(
            'ui.dailyTasks.persisted',
            { dayKey: dailyTasksDayKey, generatedCount: tasks.length, source: taskSource },
            { correlationId }
          )
          try {
            const payload = JSON.stringify(tasks)
            localStorage.setItem(`soilsense.dailyTasks.${dailyTasksDayKey}`, payload)
            storageLog.info('storage.write', { key: `soilsense.dailyTasks.${dailyTasksDayKey}`, bytes: payload.length })
          } catch (err) {
            storageLog.warn('storage.write.failed', {
              key: `soilsense.dailyTasks.${dailyTasksDayKey}`,
              ...normalizeErrorForLog(err),
            })
          }
        } catch {
          const hasCropSelection = Array.isArray(profile?.currentCrops) && profile.currentCrops.length > 0
          const tasks = hasCropSelection ? buildCropDrivenDailyTasks(fieldPlan, t) : buildDailyTasksFallback(signals, t)
          setDailyTasks(tasks)
          setDailyTasksStatus('success')
          setDailyTasksError('')
          uiLog.info(
            'ui.dailyTasks.persisted',
            { dayKey: dailyTasksDayKey, generatedCount: tasks.length, source: 'fallback' },
            { correlationId }
          )
          try {
            const payload = JSON.stringify(tasks)
            localStorage.setItem(`soilsense.dailyTasks.${dailyTasksDayKey}`, payload)
            storageLog.info('storage.write', { key: `soilsense.dailyTasks.${dailyTasksDayKey}`, bytes: payload.length })
          } catch (err) {
            storageLog.warn('storage.write.failed', {
              key: `soilsense.dailyTasks.${dailyTasksDayKey}`,
              ...normalizeErrorForLog(err),
            })
          }
        } finally {
          dailyTasksGenerationInFlightRef.current = false
        }
      }
    } catch (err) {
      signalsForReturn = {}
      // Weather/Gemini failed: still keep UI stable and show deterministic advice from whatever we can.
      setSmartWeatherSignals({})
      lastSmartWeatherFingerprintRef.current = weatherSignalsFingerprint({})
      smartWeatherLastFetchAtRef.current = Date.now()
      setSmartStatus('success')

      // Score fallback is deterministic from whatever signals we have (may be empty).
      const scoreFallback = buildSoilVitalityScoreFallback({}, lang)
      setVitalityBaseScore(scoreFallback.soilHealthScore)
      setVitalityBaseExplanation(scoreFallback.explanation)
      setVitalityScore(applyActivityImpact(scoreFallback.soilHealthScore))
      const deltaRounded = Math.round(activityImpact?.soilHealthDelta || 0)
      setVitalityExplanation(
        `${scoreFallback.explanation}\n\n${t('vitality.activityImpactPrefix')} ${
          deltaRounded >= 0 ? '+' : ''
        }${deltaRounded}`
      )
      setVitalityStatus('success')

      setVitalityError(err?.message ? err.message : String(err))

      if (dailyTasks.length === 0 && !dailyTasksGenerationInFlightRef.current) {
        const hasCropSelection = Array.isArray(profile?.currentCrops) && profile.currentCrops.length > 0
        const tasks = hasCropSelection ? buildCropDrivenDailyTasks(fieldPlan, t) : buildDailyTasksFallback({}, t)
        setDailyTasks(tasks)
        setDailyTasksStatus('success')
        setDailyTasksError('')
        uiLog.info(
          'ui.dailyTasks.persisted',
          { dayKey: dailyTasksDayKey, generatedCount: tasks.length, source: 'errorFallback' },
          { correlationId }
        )
        try {
          const payload = JSON.stringify(tasks)
          localStorage.setItem(`soilsense.dailyTasks.${dailyTasksDayKey}`, payload)
          storageLog.info('storage.write', { key: `soilsense.dailyTasks.${dailyTasksDayKey}`, bytes: payload.length })
        } catch (e) {
          storageLog.warn('storage.write.failed', {
            key: `soilsense.dailyTasks.${dailyTasksDayKey}`,
            ...normalizeErrorForLog(e),
          })
        }
      }
    }

    return signalsForReturn
  }

  const refreshSmartWeatherSignalsOnly = useCallback(
    async ({ correlationId } = {}) => {
      if (!coords) return
      if (smartWeatherFetchInFlightRef.current) return

      const now = Date.now()
      if (now - smartWeatherLastFetchAtRef.current < SMART_WEATHER_REFRESH_MS / 2) return

      smartWeatherFetchInFlightRef.current = true
      try {
        const signals = await fetchOpenMeteoSignals(coords.latitude, coords.longitude, { correlationId })
        const fp = weatherSignalsFingerprint(signals)
        if (fp !== lastSmartWeatherFingerprintRef.current) {
          lastSmartWeatherFingerprintRef.current = fp
          setSmartWeatherSignals(signals)
        }
        smartWeatherLastFetchAtRef.current = now
      } catch (err) {
        // Keep the previous alert context if the background refresh fails.
        uiLog.debug?.('ui.smartAlert.weatherRefresh.failed', {
          message: err?.message ? String(err.message) : String(err),
        })
      } finally {
        smartWeatherFetchInFlightRef.current = false
      }
    },
    [coords, SMART_WEATHER_REFRESH_MS]
  )

  async function _regenerateDailyTasksNow({ correlationId } = {}) {
    if (dailyTasksGenerationInFlightRef.current) return
    if (geoStatus !== 'success' || !coords) return

    const signals = smartWeatherSignals && typeof smartWeatherSignals === 'object' ? smartWeatherSignals : {}

    // `vitalityScore` already includes activity impact; fall back to a deterministic base score otherwise.
    const soilScoreForTasks =
      typeof vitalityScore === 'number'
        ? vitalityScore
        : applyActivityImpact(buildSoilVitalityScoreFallback(signals, lang).soilHealthScore)

    dailyTasksGenerationInFlightRef.current = true
    setDailyTasksStatus('loading')
    setDailyTasksError('')

    try {
      const dailyJson = await generateDailyTasks({
        weatherSummary: signals,
        soilHealthScore: soilScoreForTasks,
        lang,
        correlationId,
        profile,
        activityImpact,
      })

      const tasksCandidate = dailyJson?.tasks
      const cropTasks = buildCropDrivenDailyTasks(fieldPlan, t)
      const hasCropSelection = Array.isArray(profile?.currentCrops) && profile.currentCrops.length > 0
      const tasks = hasCropSelection
        ? cropTasks
        : Array.isArray(tasksCandidate) && tasksCandidate.length === 3
          ? tasksCandidate
          : buildDailyTasksFallback(signals, t)

      const taskSource = hasCropSelection
        ? 'cropPlanner'
        : Array.isArray(tasksCandidate) && tasksCandidate.length === 3
          ? 'ai'
          : 'fallback'
      setDailyTasks(tasks)
      setDailyTasksStatus('success')

      uiLog.info(
        'ui.dailyTasks.persisted',
        { dayKey: dailyTasksDayKey, generatedCount: tasks.length, source: taskSource },
        { correlationId }
      )

      try {
        const payload = JSON.stringify(tasks)
        localStorage.setItem(`soilsense.dailyTasks.${dailyTasksDayKey}`, payload)
        storageLog.info('storage.write', {
          key: `soilsense.dailyTasks.${dailyTasksDayKey}`,
          bytes: payload.length,
        })
      } catch (err) {
        storageLog.warn('storage.write.failed', {
          key: `soilsense.dailyTasks.${dailyTasksDayKey}`,
          ...normalizeErrorForLog(err),
        })
      }
    } catch {
      const hasCropSelection = Array.isArray(profile?.currentCrops) && profile.currentCrops.length > 0
      const tasks = hasCropSelection ? buildCropDrivenDailyTasks(fieldPlan, t) : buildDailyTasksFallback(signals, t)
      setDailyTasks(tasks)
      setDailyTasksStatus('success')
      setDailyTasksError('')

      uiLog.info(
        'ui.dailyTasks.persisted',
        { dayKey: dailyTasksDayKey, generatedCount: tasks.length, source: 'errorFallback' },
        { correlationId }
      )

      try {
        const payload = JSON.stringify(tasks)
        localStorage.setItem(`soilsense.dailyTasks.${dailyTasksDayKey}`, payload)
        storageLog.info('storage.write', {
          key: `soilsense.dailyTasks.${dailyTasksDayKey}`,
          bytes: payload.length,
        })
      } catch (err2) {
        storageLog.warn('storage.write.failed', {
          key: `soilsense.dailyTasks.${dailyTasksDayKey}`,
          ...normalizeErrorForLog(err2),
        })
      }
    } finally {
      dailyTasksGenerationInFlightRef.current = false
    }
  }

  function onUseEnvGeminiKey() {
    clearRuntimeGeminiApiKey()
    setUsesRuntimeKey(false)
    setKeyDraft('')
    setKeyStatus('idle')
    setKeyStatusError('')
    lastAdviceCoordsKeyRef.current = ''
    lastAlertCoordsKeyRef.current = ''
    if (coords && geoStatus === 'success') {
      void (async () => {
        const signals = await runSmartAlert()
        await runAdvice({ weatherSignalsOverride: signals })
      })()
    }
  }

  // Fetch soil advice + smart alert when coords successfully update (sequential to reduce Gemini burst / rate limits).
  useEffect(() => {
    if (geoStatus !== 'success') return
    if (!coords) return

    const key = coordsKey(coords)
    if (key === lastAdviceCoordsKeyRef.current && key === lastAlertCoordsKeyRef.current) return
    lastAdviceCoordsKeyRef.current = key
    lastAlertCoordsKeyRef.current = key
    void (async () => {
      const signals = await runSmartAlert()
      await runAdvice({ weatherSignalsOverride: signals })
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords, geoStatus])

  useEffect(() => {
    const hasCoords =
      geoStatus === 'success' &&
      Boolean(coords) &&
      typeof coords?.latitude === 'number' &&
      typeof coords?.longitude === 'number'
    const hasAddress = typeof profile?.address === 'string' && profile.address.trim().length > 0
    if (hasCoords || !hasAddress) return
    void runAdvice({ correlationId: ensureRunId() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.address, geoStatus])

  // If the user changes language, re-run Smart Alert so Gemini responses update immediately.
  useEffect(() => {
    if (activeTab !== 'dashboard') return
    if (geoStatus !== 'success') return
    if (!coords) return
    const correlationId = ensureRunId()
    appLog.info('app.ai.rerun', { reason: 'languageChange' }, { correlationId })
    lastAlertCoordsKeyRef.current = ''
    forceDailyTasksRefreshRef.current = true
    void (async () => {
      const signals = await runSmartAlert({ correlationId })
      await runAdvice({ weatherSignalsOverride: signals, correlationId })
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang])

  // Observer/Trigger pattern: when an Activity/Profile is saved, refresh dependent engines.
  // This runs asynchronously and coalesces rapid updates.
  useEffect(() => {
    if (stateChangeSeq === 0) return
    if (geoStatus !== 'success') return
    if (!coords) return
    if (!systemRecommendationContextKey) return

    if (stateChangeDebounceTimerRef.current) clearTimeout(stateChangeDebounceTimerRef.current)

    const capturedContextKey = systemRecommendationContextKey
    const timer = setTimeout(() => {
      if (lastHandledStateChangeContextKeyRef.current === capturedContextKey) return
      lastHandledStateChangeContextKeyRef.current = capturedContextKey

      const correlationId = generateRunId()
      void (async () => {
        // Ensure daily tasks are regenerated with the new activity-driven soil health signal.
        forceDailyTasksRefreshRef.current = true

        try {
          const signals = await runSmartAlert({ correlationId })
          await runAdvice({ weatherSignalsOverride: signals, correlationId })
        } catch {
          // If alert refresh fails, still try to refresh the advisor text.
          void runAdvice({ correlationId })
        }
      })()
    }, 50)

    stateChangeDebounceTimerRef.current = timer
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateChangeSeq, geoStatus, coords, systemRecommendationContextKey])

  // Smart Alert: keep weather signals “alive” while the user is on the dashboard.
  useEffect(() => {
    if (activeTab !== 'dashboard') return
    if (geoStatus !== 'success') return
    if (!coords) return

    const tick = () => {
      void refreshSmartWeatherSignalsOnly({ correlationId: generateRunId() })
    }

    const id = setInterval(tick, SMART_WEATHER_REFRESH_MS)
    tick()
    return () => clearInterval(id)
  }, [activeTab, geoStatus, coords, refreshSmartWeatherSignalsOnly, SMART_WEATHER_REFRESH_MS])

  // Knowledge Hub: generate once when we first open the Guide tab.
  useEffect(() => {
    if (activeTab !== 'guide') return
    if (didRequestHubRef.current) return

    didRequestHubRef.current = true
    setHubStatus('loading')
    setHubError('')
    setKnowledgeHub(null)

    ;(async () => {
      const correlationId = generateRunId()
      try {
        const hub = await generateKnowledgeHub({ lang, correlationId })
        setKnowledgeHub(hub)
        setHubStatus('success')
        const categories = Array.isArray(hub?.categories) ? hub.categories : []
        uiLog.info(
          'ui.knowledgeHub.categoriesLoaded',
          {
            categoryCount: categories.length,
            names: categories.map((c) => c?.name).filter(Boolean),
          },
          { correlationId }
        )
      } catch (err) {
        setHubStatus('error')
        setHubError(err?.message ? err.message : String(err))
      }
    })()
  }, [activeTab])

  // Knowledge Hub: refresh when language changes while staying on the Guide tab.
  useEffect(() => {
    if (activeTab !== 'guide') return
    if (!didRequestHubRef.current) return
    if (hubStatus === 'loading') return

    setHubStatus('loading')
    setHubError('')
    setKnowledgeHub(null)

    ;(async () => {
      const correlationId = generateRunId()
      try {
        const hub = await generateKnowledgeHub({ lang, correlationId })
        setKnowledgeHub(hub)
        setHubStatus('success')
        const categories = Array.isArray(hub?.categories) ? hub.categories : []
        uiLog.info(
          'ui.knowledgeHub.categoriesLoaded',
          {
            categoryCount: categories.length,
            names: categories.map((c) => c?.name).filter(Boolean),
          },
          { correlationId }
        )
      } catch (err) {
        setHubStatus('error')
        setHubError(err?.message ? err.message : String(err))
      }
    })()
  }, [lang, activeTab])

  return (
    <div className="app-shell">
      <main className="app-content">
        <div className="app-topbar" aria-label="App settings">
          <div className="lang-switcher">
            <button
              type="button"
              className="lang-icon-btn"
              onClick={() => {
                setIsLangMenuOpen((v) => !v)
              }}
              aria-label={t('language.label')}
              aria-expanded={isLangMenuOpen}
            >
              <Globe2 size={18} strokeWidth={2.2} className="lang-icon" />
              <span className="lang-current">{String(lang || 'en').toUpperCase()}</span>
            </button>

            {isLangMenuOpen ? (
              <div className="lang-menu lang-menu-open" role="menu" aria-label={t('language.label')}>
                {languageMenuItems.map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    className={item.code === lang ? 'lang-menu-item lang-menu-item-active' : 'lang-menu-item'}
                    onClick={() => {
                      changeLanguage(item.code)
                      setIsLangMenuOpen(false)
                    }}
                    role="menuitem"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div key={activeTab} className="view-swap">
          {activeTab === 'dashboard' ? (
            <section className="dashboard dashboard-stack">
              <header className="dashboard-header">
                <h1 className="dashboard-title">{t('dashboard.welcomeBackFarmer')}</h1>
                <p className="dashboard-subtitle">{locationLine}</p>

                <div className="green-badge-row" aria-label="Sustainability level">
                  <div className="green-score-pill">
                    <div className="green-score-progress-track" aria-hidden="true">
                      <div
                        className="green-score-progress-fill"
                        style={{
                          width: `${effectiveGreenScore}%`,
                          transition: shouldAnimateGreenScoreFill ? 'width 800ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
                        }}
                      />
                    </div>
                    <div className="green-score-pill-content">
                      <BadgeCheck size={16} strokeWidth={2.2} />
                      <span className="green-score-label">{t('dashboard.greenScore')}</span>
                      <span className="green-score-value">{effectiveGreenScore}</span>
                    </div>
                  </div>
                  <div className="green-level-pill">
                    <span className="muted" style={{ opacity: 0.95, fontSize: 12 }}>
                      {t('dashboard.sustainabilityLevel')}
                    </span>
                    <span className="green-level-value">{greenLevel.name}</span>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-ghost btn-inline"
                  style={{ marginTop: 10 }}
                  onClick={() => {
                    uiLog.info('ui.modal.profile', { action: 'open' })
                    setSoilTypeDraft(profile?.soilType || 'loam')
                    setAddressDraft(typeof profile?.address === 'string' ? profile.address : '')
                    setFieldSizeDraft(
                      typeof profile?.fieldSize?.value === 'number' ? String(profile.fieldSize.value) : ''
                    )
                    setFieldSizeUnitDraft(profile?.fieldSize?.unit === 'sqm' || profile?.fieldSize?.unit === 'ha' ? profile.fieldSize.unit : 'ha')
                    setWorkforceDraft(typeof profile?.workforce === 'number' ? String(profile.workforce) : '')
                    setEquipmentDraft(
                      profile?.equipment || { shovel: false, tractor: false, sprinkler: false, dripIrrigation: false }
                    )
                    setCurrentCropsDraft(Array.isArray(profile?.currentCrops) ? profile.currentCrops : [])
                    setProfileOpen(true)
                  }}
                >
                  {t('profile.manageProfile')}
                </button>
                {profileSaveNotice ? (
                  <p className="muted" style={{ marginTop: 8 }}>
                    {profileSaveNotice}
                  </p>
                ) : null}
              </header>

              {usesRuntimeKey ? (
                <section className="card runtime-key-banner" aria-label={t('keyPanel.usingStoredKey')}>
                  <div className="card-body runtime-key-banner-inner">
                    <p className="muted" style={{ margin: 0 }}>
                      {t('keyPanel.usingStoredKey')}
                    </p>
                    <button type="button" className="btn btn-ghost btn-inline" onClick={onUseEnvGeminiKey}>
                      {t('keyPanel.useEnvKey')}
                    </button>
                  </div>
                </section>
              ) : null}

              <section className="command-center">
                <SoilVitalityScore
                  status={vitalityStatus}
                  score={vitalityScore}
                  explanation={vitalityExplanation}
                  errorText={vitalityError}
                />

              <section
                className={
                  smartAlert?.isCritical || smartAlert?.riskType === 'frost'
                    ? 'card smart-alert-card smart-alert-critical'
                    : 'card smart-alert-card'
                }
              >
                <div className="card-body">
                  <div className="smart-alert-top">
                    <Sun size={18} strokeWidth={1.6} className="smart-alert-icon" />
                    <p className="smart-alert-label">{t('common.smartAlert')}</p>
                  </div>

                  {smartStatus === 'idle' ? (
                    <p className="muted">
                      {geoStatus === 'success'
                        ? t('common.preparingAlert')
                        : t('fields.locationSetupHint')}
                    </p>
                  ) : null}

                  {smartStatus === 'loading' ? (
                    <p className="muted">{t('common.checkingConditions')}</p>
                  ) : null}

                  {smartStatus === 'error' ? (
                    <div className="smart-alert-error">
                      <p className="muted">{t('common.couldNotGenerateAlert')}</p>
                      <pre className="error-pre">{smartError}</pre>
                    </div>
                  ) : null}

                  {smartStatus === 'success' && smartAlert ? (
                    <div className="smart-alert-body">
                      <p
                        className={
                          smartAlert?.isCritical || smartAlert?.riskType === 'frost'
                            ? 'smart-headline smart-headline-critical'
                            : 'smart-headline'
                        }
                      >
                        {smartAlert.status || '—'}
                      </p>
                      {smartAlert.reason ? (
                        <p className="muted smart-details smart-reason">{smartAlert.reason}</p>
                      ) : null}
                      {typeof locationIntel?.regionalSummary === 'string' && locationIntel.regionalSummary.trim() ? (
                        <p className="muted smart-details">{locationIntel.regionalSummary}</p>
                      ) : null}
                      {Array.isArray(smartAlert.instruction) && smartAlert.instruction.length ? (
                        <ul className="smart-instruction">
                          {smartAlert.instruction.slice(0, 4).map((step, idx) => (
                            <li key={`${idx}-${step}`}>{step}</li>
                          ))}
                        </ul>
                      ) : null}
                      {Array.isArray(smartAlert.tags) && smartAlert.tags.length ? (
                        <div className="chips chips-tight">
                          {smartAlert.tags.slice(0, 4).map((tag) => (
                            <span key={tag} className="chip">
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </section>
              </section>

              <section className="card daily-tasks-card">
                <div className="card-top">
                  <div className="card-title-wrap">
                    <h2 className="card-title">{t('dashboard.dailyTasks')}</h2>
                    <div className="pill">{t('dashboard.today')}</div>
                  </div>
                  <div className="card-hint">{t('dashboard.dailyTasksHint')}</div>
                </div>

                <div className="card-body">
                  {dailyTasksStatus === 'loading' || dailyTasksStatus === 'idle' ? (
                    <p className="muted">
                      {dailyTasksStatus === 'loading'
                        ? t('common.generateTasks')
                        : dailyTasks.length
                          ? t('dashboard.generated')
                          : t('dashboard.noLocationForTasks')}
                    </p>
                  ) : null}

                  {dailyTasksStatus === 'error' ? (
                    <div className="daily-tasks-error">
                      <p className="muted">{t('common.couldNotGenerateTasks')}</p>
                      {dailyTasksError ? <pre className="error-pre">{dailyTasksError}</pre> : null}
                    </div>
                  ) : null}

                  {dailyTasksStatus === 'success' && dailyTasks.length ? (
                    <div className="daily-tasks-list">
                      {dailyTasks.map((t) => {
                        const done = completedTaskIds.includes(String(t.id))
                        return (
                          <label key={t.id} className={done ? 'task-row task-row-done' : 'task-row'}>
                            <input
                              type="checkbox"
                              checked={done}
                              disabled={done}
                              onChange={() => {
                                if (!done) toggleTaskCompleted(t.id)
                              }}
                            />
                            <div className="task-content">
                              <div className="task-title-row">
                                <span className="task-title">{t.title}</span>
                                {typeof t.estimatedMinutes === 'number' ? (
                                  <span className="task-minutes">{t.estimatedMinutes}m</span>
                                ) : null}
                              </div>
                              {t.whyThisTaskHelps ? (
                                <p className="task-why muted">{t.whyThisTaskHelps}</p>
                              ) : null}
                              {Array.isArray(t.steps) && t.steps.length ? (
                                <ol className="task-steps">
                                  {t.steps.slice(0, 4).map((s, idx) => (
                                    <li key={idx}>{s}</li>
                                  ))}
                                </ol>
                              ) : null}
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="card">
                <div className="card-top">
                  <div className="card-title-wrap">
                    <h2 className="card-title">{t('activity.addActivityTitle')}</h2>
                  </div>
                  <div className="card-hint">{t('activity.addActivityHint')}</div>
                </div>
                <div className="card-body">
                  <button
                    type="button"
                    className="btn btn-primary btn-inline"
                    onClick={() =>
                      setActivityPickerOpen((v) => {
                        const next = !v
                        uiLog.info('ui.modal.activityPicker', { action: next ? 'open' : 'close' })
                        return next
                      })
                    }
                  >
                    {t('activity.addActivityButton')}
                  </button>

                  {activityPickerOpen ? (
                    <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                      {activityDraftTypeId ? (
                        <div style={{ display: 'grid', gap: 10 }}>
                          <div className="muted" style={{ fontWeight: 800 }}>
                            {t(`activity.types.${activityDraftTypeId}`)}
                          </div>

                          <label className="field" style={{ margin: 0 }}>
                            <span className="field-label">{t('activity.quantityLabel')}</span>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <input
                                className="field-input"
                                value={activityDraftQuantity}
                                inputMode="decimal"
                                onChange={(e) => setActivityDraftQuantity(e.target.value)}
                                placeholder="e.g., 10"
                                style={{ flex: 1 }}
                              />
                              <select
                                className="field-input"
                                value={activityDraftUnit}
                                onChange={(e) => setActivityDraftUnit(e.target.value)}
                                style={{ width: 150 }}
                              >
                                {(ACTIVITY_TYPES.find((x) => x.id === activityDraftTypeId)?.id === 'pesticide-application'
                                  ? ['liters', 'kg', 'g']
                                  : ACTIVITY_TYPES.find((x) => x.id === activityDraftTypeId)?.id ===
                                      'added-compost' ||
                                    ACTIVITY_TYPES.find((x) => x.id === activityDraftTypeId)?.id ===
                                      'used-organic-fertilizer' ||
                                    ACTIVITY_TYPES.find((x) => x.id === activityDraftTypeId)?.id === 'fertilizer-application'
                                    ? ['kg', 'bags']
                                    : ['liters', 'kg']
                                ).map((u) => (
                                  <option key={u} value={u}>
                                    {t(`activity.units.${u}`)}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </label>

                          {activityDraftTypeId === 'pesticide-application' ? (
                            <label className="field" style={{ margin: 0 }}>
                              <span className="field-label">{t('activity.pesticideKindLabel')}</span>
                              <select
                                className="field-input"
                                value={activityDraftPesticideKind}
                                onChange={(e) => setActivityDraftPesticideKind(e.target.value)}
                              >
                                <option value="chemical">{t('activity.pesticideKinds.chemical')}</option>
                                <option value="biological">{t('activity.pesticideKinds.biological')}</option>
                              </select>
                            </label>
                          ) : null}

                          {activityDraftTypeId === 'fertilizer-application' ? (
                            <label className="field" style={{ margin: 0 }}>
                              <span className="field-label">{t('activity.fertilizerTypeLabel')}</span>
                              <select
                                className="field-input"
                                value={activityDraftFertilizerType}
                                onChange={(e) => setActivityDraftFertilizerType(e.target.value)}
                              >
                                <option value="organic">{t('activity.fertilizerTypes.organic')}</option>
                                <option value="chemical">{t('activity.fertilizerTypes.chemical')}</option>
                              </select>
                            </label>
                          ) : null}

                          {activityDraftError ? <pre className="error-pre">{activityDraftError}</pre> : null}

                          <div className="key-actions">
                            <button
                              type="button"
                              className="btn btn-primary"
                              onClick={() => {
                                const quantity = Number(activityDraftQuantity)
                                if (!Number.isFinite(quantity) || quantity <= 0) {
                                  setActivityDraftError(t('activity.quantityLabel') + ': invalid value')
                                  return
                                }
                                const meta = {}
                                if (activityDraftTypeId === 'pesticide-application') {
                                  meta.pesticideKind = activityDraftPesticideKind
                                }
                                if (activityDraftTypeId === 'fertilizer-application') {
                                  meta.fertilizerType = activityDraftFertilizerType
                                }
                                addActivity({
                                  activityTypeId: activityDraftTypeId,
                                  quantity,
                                  unit: activityDraftUnit,
                                  meta,
                                })
                              }}
                            >
                              {t('activity.addActivitySave')}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => {
                                setActivityDraftTypeId('')
                                setActivityDraftQuantity('')
                                setActivityDraftUnit('')
                                setActivityDraftError('')
                              }}
                            >
                              {t('activity.addActivityCancel')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'grid', gap: 8 }}>
                          {ACTIVITY_TYPES.map((act) => (
                            <button
                              key={act.id}
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => {
                                setActivityDraftTypeId(act.id)
                                setActivityDraftQuantity(String(act.defaultQuantity ?? 1))
                                setActivityDraftUnit(act.defaultUnit ?? '')
                                setActivityDraftPesticideKind('chemical')
                                setActivityDraftFertilizerType('organic')
                                setActivityDraftError('')
                              }}
                            >
                              {t(`activity.types.${act.id}`)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}

                  <div style={{ marginTop: 14 }}>
                    <p className="section-title">{t('activity.recentActivities')}</p>
                    {recentActivities.length ? (
                      <ul className="ordered-list">
                        {recentActivities.slice(0, 7).map((item) => (
                          <li key={item.id}>
                            {t(`activity.types.${item.activityTypeId}`)}
                            {typeof item.quantity === 'number' ? (
                              <>
                                {' '}
                                - {item.quantity}
                                {item.unit ? ` ${item.unit}` : null}
                              </>
                            ) : null}
                            {' '}
                            {new Date(item.timestamp).toLocaleDateString()}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">{t('activity.noRecentActivities')}</p>
                    )}
                  </div>
                </div>
              </section>

              <section className="card">
                <div className="card-top">
                  <div className="card-title-wrap">
                    <h2 className="card-title">{t('common.soilAdvice')}</h2>
                    <Droplet size={18} strokeWidth={1.6} className="card-accent-icon" />
                  </div>
                  <div className="card-hint">{t('common.builtForSoilHealth')}</div>
                </div>

                {geoStatus !== 'success' && !(typeof profile?.address === 'string' && profile.address.trim()) ? (
                  <div className="card-body">
                    <p className="muted">{t('fields.locationSetupHint')}</p>
                    <p className="muted" style={{ marginTop: 10, lineHeight: 1.4 }}>
                      {t('common.soilAdviceEmpatheticReminder')}
                    </p>
                  </div>
                ) : null}

                {aiStatus === 'loading' ? (
                  <div className="card-body">
                    <p className="muted">{t('common.generatingNextStepPlan')}</p>
                    <p className="muted" style={{ marginTop: 10, lineHeight: 1.4 }}>
                      {t('common.soilAdviceEmpatheticReminder')}
                    </p>
                  </div>
                ) : null}

                {aiStatus === 'error' ? (
                  <div className="card-body">
                    <p className="muted" style={{ marginBottom: 10, lineHeight: 1.4 }}>
                      {t('common.soilAdviceEmpatheticReminder')}
                    </p>
                    <p className="muted">{t('common.couldNotGenerateAdvice')}</p>
                    <pre className="error-pre">{aiError}</pre>
                    <button
                      className="btn btn-primary"
                      onClick={() => {
                        lastAdviceCoordsKeyRef.current = ''
                        runAdvice()
                      }}
                    >
                      {t('common.retryAdvice')}
                    </button>
                  </div>
                ) : null}

                {(geoStatus === 'success' || (typeof profile?.address === 'string' && profile.address.trim())) && aiStatus === 'idle' ? (
                  <div className="card-body">
                    <p className="muted" style={{ lineHeight: 1.4 }}>
                      {t('common.soilAdviceEmpatheticReminder')}
                    </p>
                  </div>
                ) : null}

                {aiStatus === 'success' && aiAdvice ? (
                  <div className="card-body">
                    <pre className="advice-pre">{aiAdvice}</pre>
                  </div>
                ) : null}
              </section>

              {keyPromptOpen ? (
                <section className="card gemini-key-card">
                  <div className="card-body">
                    <p className="muted gemini-key-label">{t('keyPanel.title')}</p>
                    <p className="muted" style={{ marginTop: 6 }}>
                      {t('keyPanel.subtitle')}
                    </p>

                    <label className="field" style={{ marginTop: 12 }}>
                      <span className="field-label">{t('keyPanel.apiKey')}</span>
                      <input
                        value={keyDraft}
                        onChange={(e) => setKeyDraft(e.target.value)}
                        placeholder={t('keyPanel.pasteApiKeyValue')}
                        className="field-input"
                      />
                    </label>

                    {keyStatus === 'error' && keyStatusError ? (
                      <pre className="error-pre" style={{ marginTop: 10 }}>
                        {keyStatusError}
                      </pre>
                    ) : null}

                    <div className="key-actions">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={onTestAndSaveKey}
                        disabled={keyStatus === 'testing'}
                      >
                        {keyStatus === 'testing'
                          ? t('keyPanel.testing')
                          : keyStatus === 'saved'
                            ? t('keyPanel.saved')
                            : t('keyPanel.saveAndRetry')}
                      </button>
                      {usesRuntimeKey ? (
                        <button type="button" className="btn btn-ghost" onClick={onUseEnvGeminiKey}>
                          {t('keyPanel.useEnvKey')}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setKeyPromptOpen(false)}
                      >
                        {t('keyPanel.notNow')}
                      </button>
                    </div>
                  </div>
                </section>
              ) : null}
            </section>
          ) : null}

          {activeTab === 'planner' ? (
            <section className="dashboard dashboard-stack">
              <header className="dashboard-header">
                <h1 className="dashboard-title">{t('fieldPlanner.title')}</h1>
                <p className="dashboard-subtitle">{t('fieldPlanner.subtitle')}</p>
              </header>
              <FieldPlanner t={t} fieldPlan={fieldPlan} />
            </section>
          ) : null}

          {activeTab === 'compost' ? (
            <section className="dashboard">
              <header className="dashboard-header">
                <h1 className="dashboard-title">{t('tabs.compost')}</h1>
                <p className="dashboard-subtitle">{t('dashboard.compostHeaderSubtitle')}</p>
              </header>
              <section className="card">
                <div className="card-body">
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 0, marginBottom: 12 }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-inline"
                      onClick={() => setCompostGuideOpen((v) => !v)}
                    >
                      <BookOpen size={16} strokeWidth={2.2} />
                      {t('compostGuide.howToCompostButton')}
                    </button>
                  </div>

                  {compostGuideOpen ? <CompostGuide compact /> : null}

                  <CompostWizard
                    onRecipeGenerated={() => addGreenPointsOnce(`compost-recipe:${dailyTasksDayKey}`, 10)}
                    lang={lang}
                  />
                </div>
              </section>
            </section>
          ) : null}

          {activeTab === 'guide' ? (
            <section className="dashboard">
              <header className="dashboard-header">
                <h1 className="dashboard-title">{t('guide.guideTitle')}</h1>
                <p className="dashboard-subtitle">{t('guide.guideSubtitle')}</p>
              </header>
              <section className="card">
                <div className="card-body">
                  <div className="guide-insights-scroll">
                    <EducationalGuide
                      coords={coords || null}
                      climateZoneHint={deriveClimateZoneHintFromWeatherSignals(
                        smartWeatherSignals && typeof smartWeatherSignals === 'object' ? smartWeatherSignals : {}
                      )}
                      activityImpact={activityImpact || null}
                    />
                  </div>

                  {hubStatus === 'idle' || hubStatus === 'loading' ? (
                    <p className="muted">
                      {hubStatus === 'loading'
                        ? t('common.generatingKnowledgeHub')
                        : t('common.loadingKnowledgeHub')}
                    </p>
                  ) : null}

                  {hubStatus === 'error' ? (
                    <div>
                      <p className="muted">{t('guide.couldNotLoadKnowledgeHub')}</p>
                      <pre className="error-pre">{hubError}</pre>
                    </div>
                  ) : null}

                  {hubStatus === 'success' && knowledgeHub ? (
                    <div className="knowledge-hub">
                      <div className="knowledge-hub-title">{t('common.knowledgeHub')}</div>
                      {Array.isArray(knowledgeHub.categories) &&
                      knowledgeHub.categories.length ? (
                        <div className="knowledge-grid">
                          {knowledgeHub.categories.map((c) => (
                            <div key={c.name} className="knowledge-category">
                              <p className="knowledge-category-title">{c.name}</p>
                              {c.summary ? (
                                <p className="muted knowledge-summary">{c.summary}</p>
                              ) : null}
                              {Array.isArray(c.bullets) && c.bullets.length ? (
                                <ul className="knowledge-bullets">
                                  {c.bullets.map((b, idx) => (
                                    <li key={idx}>{b}</li>
                                  ))}
                                </ul>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="muted">{t('guide.categoriesUnavailable')}</p>
                      )}
                    </div>
                  ) : null}
                </div>
              </section>
            </section>
          ) : null}

          {activeTab === 'scan' ? (
            <PlantScanner
              lang={lang}
              onScanComplete={(json) => {
                setPlantScanResult(json)
                uiLog.info('ui.smartAlert.biological.scanComplete', {
                  healthStatus: json?.healthStatus,
                })
              }}
            />
          ) : null}
        </div>

        {profileOpen ? (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.22)',
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
              zIndex: 1200,
              padding: 16,
            }}
          >
            <section className="card" style={{ width: '100%', maxWidth: 620, maxHeight: '82vh', overflowY: 'auto' }}>
              <div className="card-top">
                <div className="card-title-wrap">
                  <h2 className="card-title">{t('profile.title')}</h2>
                </div>
                <div className="card-hint">{t('profile.subtitle')}</div>
              </div>
              <div className="card-body">
                <label className="field">
                  <span className="field-label">{t('profile.soilTypeLabel')}</span>
                  <select
                    className="field-input"
                    value={soilTypeDraft}
                    onChange={(e) => setSoilTypeDraft(e.target.value)}
                  >
                    <option value="loam">{t('profile.soilTypes.loam')}</option>
                    <option value="clay">{t('profile.soilTypes.clay')}</option>
                    <option value="sandy">{t('profile.soilTypes.sandy')}</option>
                    <option value="silty">{t('profile.soilTypes.silty')}</option>
                  </select>
                </label>

                <label className="field" style={{ marginTop: 12 }}>
                  <span className="field-label">{t('profile.fieldSizeLabel')}</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      className="field-input"
                      value={fieldSizeDraft}
                      inputMode="decimal"
                      onChange={(e) => setFieldSizeDraft(e.target.value)}
                      placeholder="e.g., 1000"
                      style={{ flex: 1 }}
                    />
                    <select
                      className="field-input"
                      value={fieldSizeUnitDraft}
                      onChange={(e) => setFieldSizeUnitDraft(e.target.value)}
                      style={{ width: 150 }}
                    >
                      <option value="sqm">{t('profile.fieldSizeUnits.sqm')}</option>
                      <option value="ha">{t('profile.fieldSizeUnits.ha')}</option>
                    </select>
                  </div>
                </label>

                <label className="field" style={{ marginTop: 12 }}>
                  <span className="field-label">{t('fields.fieldAddress')}</span>
                  <input
                    className="field-input"
                    value={addressDraft}
                    onChange={(e) => setAddressDraft(e.target.value)}
                    placeholder={t('fields.locationSetupHint')}
                  />
                </label>

                <label className="field" style={{ marginTop: 12 }}>
                  <span className="field-label">{t('profile.workforceLabel')}</span>
                  <input
                    className="field-input"
                    value={workforceDraft}
                    inputMode="numeric"
                    onChange={(e) => setWorkforceDraft(e.target.value)}
                    placeholder="e.g., 1"
                  />
                </label>

                <div style={{ marginTop: 12 }}>
                  <p className="field-label" style={{ marginBottom: 6 }}>
                    {t('profile.inventoryLabel')}
                  </p>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {[
                      { key: 'shovel', label: t('profile.equipmentTools.shovel') },
                      { key: 'tractor', label: t('profile.equipmentTools.tractor') },
                      { key: 'sprinkler', label: t('profile.equipmentTools.sprinkler') },
                      { key: 'dripIrrigation', label: t('profile.equipmentTools.dripIrrigation') },
                    ].map((item) => (
                      <label key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={Boolean(equipmentDraft?.[item.key])}
                          onChange={(e) =>
                            setEquipmentDraft((prev) => ({
                              ...(prev || { shovel: false, tractor: false, sprinkler: false, dripIrrigation: false }),
                              [item.key]: e.target.checked,
                            }))
                          }
                        />
                        <span style={{ fontWeight: 800 }}>{item.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <p className="field-label" style={{ marginBottom: 6 }}>
                    {t('profile.currentCropsLabel')}
                  </p>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {availableCrops.map((crop) => {
                      const checked = currentCropsDraft.includes(crop.id)
                      return (
                        <label key={crop.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setCurrentCropsDraft((prev) =>
                                e.target.checked ? [...prev, crop.id] : prev.filter((x) => x !== crop.id)
                              )
                            }}
                          />
                          <span style={{ fontWeight: 800 }}>{t(`crops.${crop.id}`)}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>

                <p className="muted" style={{ marginTop: 10 }}>
                  {typeof coords?.latitude === 'number' && typeof coords?.longitude === 'number'
                    ? `${t('profile.locationSaved')}: ${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`
                    : t('profile.locationNotSaved')}
                </p>
                {typeof locationIntel?.climateZone === 'string' ? (
                  <p className="muted" style={{ marginTop: 6 }}>
                    {locationIntel.climateZone}
                  </p>
                ) : null}

                <section
                  style={{
                    marginTop: 12,
                    border: '1px solid rgba(26, 67, 50, 0.14)',
                    borderRadius: 12,
                    padding: 10,
                    background: 'rgba(124, 166, 137, 0.06)',
                  }}
                >
                  <p className="field-label" style={{ marginBottom: 6 }}>
                    {t('profile.currentSituation')}
                  </p>
                  <p className="muted" style={{ margin: 0 }}>
                    {t(`profile.soilTypes.${profile?.soilType || 'loam'}`)} |{' '}
                    {typeof profile?.fieldSize?.value === 'number'
                      ? `${profile.fieldSize.value} ${t(`profile.fieldSizeUnits.${profile.fieldSize.unit || 'ha'}`)}`
                      : '-'}{' '}
                    | {typeof profile?.workforce === 'number' ? profile.workforce : '-'}
                  </p>
                </section>

                <div className="key-actions">
                  <button type="button" className="btn btn-primary" onClick={saveProfileDraft}>
                    {t('profile.saveAndExit')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      uiLog.info('ui.modal.profile', { action: 'close', reason: 'cancel' })
                      setProfileOpen(false)
                    }}
                  >
                    {t('profile.cancel')}
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : null}
      </main>

      <nav className="bottom-nav" aria-label="Bottom navigation">
        {TABS.map((t) => {
          const isActive = t.id === activeTab
          const Icon = t.icon
          return (
            <button
              key={t.id}
              className={isActive ? 'nav-item nav-item-active' : 'nav-item'}
              onClick={() =>
                setActiveTab((prev) => {
                  if (prev !== t.id) uiLog.info('ui.tab.change', { from: prev, to: t.id })
                  return t.id
                })
              }
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon size={22} strokeWidth={1.6} className="nav-icon" />
              <span className="nav-label">{t.label}</span>
            </button>
          )
        })}
      </nav>

      <DiagnosticsPanel />
    </div>
  )
}

