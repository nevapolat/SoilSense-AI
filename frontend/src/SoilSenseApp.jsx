import './App.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BadgeCheck, BookOpen, Leaf, TreePine, Camera, Globe2, Sun, Droplet } from 'lucide-react'
import {
  generateKnowledgeHub,
  generateRegenerativeAdvice,
  generateSmartAlert,
  generateSoilVitalityScore,
  buildSoilVitalityScoreFallback,
  generateDailyTasks,
  clearRuntimeGeminiApiKey,
  getRuntimeGeminiApiKey,
  setRuntimeGeminiApiKey,
  testGeminiApiKey,
} from './lib/gemini'
import CompostWizard from './components/CompostWizard'
import SoilVitalityScore from './components/SoilVitalityScore'
import PlantScanner from './components/PlantScanner'
import DiagnosticsPanel from './components/DiagnosticsPanel'
import { useI18n } from './i18n/useI18n'
import { bucketAccuracyMeters, createLogger, generateRunId, normalizeErrorForLog } from './lib/logger'

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

const ACTIVITY_TYPES = [
  { id: 'added-eggshells', points: 4 },
  { id: 'watered', points: 2 },
  { id: 'added-compost', points: 5 },
  { id: 'used-organic-fertilizer', points: 3 },
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
  )}&current=temperature_2m,relative_humidity_2m,dew_point_2m,precipitation,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&hourly=temperature_2m,dew_point_2m&forecast_hours=48&timezone=auto`

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

  // Smart Alert card (weather + Gemini, with deterministic fallback).
  const [smartStatus, setSmartStatus] = useState('idle') // idle|loading|success|error
  const [smartError, setSmartError] = useState('')
  const [smartAlert, setSmartAlert] = useState(null)
  const lastAlertCoordsKeyRef = useRef('')

  // Task 7 (UI upgrade): Soil Vitality Score (0-100)
  const [vitalityStatus, setVitalityStatus] = useState('idle') // idle|loading|success|error
  const [vitalityError, setVitalityError] = useState('')
  const [vitalityScore, setVitalityScore] = useState(null)
  const [vitalityExplanation, setVitalityExplanation] = useState('')

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

  const greenLevel = useMemo(() => {
    const found = GREEN_LEVELS.find((l) => greenScore >= l.min && greenScore <= l.max)
    return found || GREEN_LEVELS[0]
  }, [GREEN_LEVELS, greenScore])

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

  // Task 11 (Daily tasks): generated once per day.
  const getTodayKey = () => {
    // Using UTC date to keep it deterministic across reloads.
    return new Date().toISOString().slice(0, 10)
  }

  const [dailyTasksDayKey] = useState(getTodayKey())
  const [dailyTasksStatus, setDailyTasksStatus] = useState('idle') // idle|loading|success|error
  const [dailyTasksError, setDailyTasksError] = useState('')
  const [dailyTasks, setDailyTasks] = useState([]) // { id,title,whyThisTaskHelps,steps,estimatedMinutes }
  const [completedTaskIds, setCompletedTaskIds] = useState([]) // persisted per day
  const dailyTasksGenerationInFlightRef = useRef(false)
  const forceDailyTasksRefreshRef = useRef(false)

  // Profile + Activity system
  const [profileOpen, setProfileOpen] = useState(false)
  const [profile, setProfile] = useState(() => loadProfile())
  const [soilTypeDraft, setSoilTypeDraft] = useState(
    () => loadProfile()?.soilType || 'loam'
  )
  const [activityLog, setActivityLog] = useState(() => loadActivityLog())
  const [activityPickerOpen, setActivityPickerOpen] = useState(false)

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const activityImpactPoints = useMemo(() => {
    const sum = recentActivities.reduce((acc, item) => {
      const def = ACTIVITY_TYPES.find((x) => x.id === item.activityTypeId)
      return acc + (def?.points || 0)
    }, 0)
    return Math.max(0, Math.min(20, sum))
  }, [recentActivities])

  function applyActivityImpact(baseScore) {
    if (typeof baseScore !== 'number') return baseScore
    const adjusted = Math.round(baseScore + activityImpactPoints)
    return Math.max(0, Math.min(100, adjusted))
  }

  function saveProfileDraft() {
    uiLog.info('ui.modal.profile', { action: 'close', reason: 'save' })
    const next = {
      soilType: soilTypeDraft,
      latitude:
        typeof coords?.latitude === 'number' ? coords.latitude : profile?.latitude ?? null,
      longitude:
        typeof coords?.longitude === 'number' ? coords.longitude : profile?.longitude ?? null,
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

    if (typeof next.latitude === 'number' && typeof next.longitude === 'number') {
      setCoords((prev) => ({
        latitude: next.latitude,
        longitude: next.longitude,
        accuracy: prev?.accuracy || null,
      }))
      setGeoStatus('success')
      setGeoError('')
    }

    setProfileOpen(false)
  }

  function addActivity(activityTypeId) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      activityTypeId,
      timestamp: new Date().toISOString(),
    }
    setActivityLog((prev) => {
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
    if (geoStatus === 'loading') return t('common.geolocation.requesting')
    if (geoStatus === 'error')
      return geoError
        ? `${t('common.geolocation.locationErrorPrefix')}${geoError}`
        : t('common.geolocation.locationUnavailable')
    if (geoStatus === 'success' && coords) {
      const lat = toFixedOrDash(coords.latitude, 5)
      const lon = toFixedOrDash(coords.longitude, 5)
      return `${t('common.geolocation.usingLocation')}: ${t('common.geolocation.latLabel')} ${lat}, ${t('common.geolocation.lonLabel')} ${lon}`
    }
    return t('common.geolocation.notSetYet')
  }, [coords, geoError, geoStatus, t])

  function requestLocation() {
    if (!('geolocation' in navigator)) {
      setGeoStatus('error')
      setGeoError(t('common.geolocation.notSupported'))
      geoLog.warn('geo.prompt.unsupported', {})
      return
    }
    if (locationRequestInFlightRef.current) return
    locationRequestInFlightRef.current = true

    geoLog.info('geo.prompt.start', {})
    setGeoStatus('loading')
    setGeoError('')
    setCoords(null)
    setVitalityStatus('idle')
    setVitalityError('')
    setVitalityScore(null)
    setVitalityExplanation('')

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const nextCoords = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }
        geoLog.info(
          'geo.location.success',
          {
            accuracyBucket: bucketAccuracyMeters(pos.coords.accuracy),
            ...(import.meta.env.VITE_LOG_PRECISE_LOCATION === 'true'
              ? {
                  latRounded: Number(pos.coords.latitude).toFixed(2),
                  lonRounded: Number(pos.coords.longitude).toFixed(2),
                }
              : {}),
          },
          {}
        )
        setCoords(nextCoords)
        setGeoStatus('success')
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
        locationRequestInFlightRef.current = false
      },
      (err) => {
        const message =
          err?.code === 1
            ? t('common.geolocation.permissionDenied')
            : err?.code === 2
              ? t('common.geolocation.positionUnavailable')
              : err?.code === 3
                ? t('common.geolocation.timedOut')
                : err?.message
                  ? err.message
                  : t('common.geolocation.unknown')
        const reason =
          err?.code === 1 ? 'denied' : err?.code === 2 ? 'unavailable' : err?.code === 3 ? 'timeout' : 'unknown'
        geoLog.warn('geo.location.error', { code: err?.code, reason, message: String(message).slice(0, 200) }, {})
        setGeoStatus('error')
        setGeoError(message)
        locationRequestInFlightRef.current = false
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 30000,
      }
    )
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
          await runAdvice()
          await runSmartAlert()
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

    requestLocation()
  }, [])

  async function runAdvice() {
    if (!coords) return
    const correlationId = ensureRunId()
    setAiStatus('loading')
    setAiAdvice('')
    setAiError('')

    try {
      const text = await generateRegenerativeAdvice({
        latitude: coords.latitude,
        longitude: coords.longitude,
        lang,
        correlationId,
      })
      setAiAdvice(text)
      setAiStatus('success')
    } catch (err) {
      setAiStatus('error')
      setAiError(err?.message ? err.message : String(err))
    }
  }

  async function runSmartAlert() {
    if (!coords) return
    const correlationId = ensureRunId()
    setSmartStatus('loading')
    setSmartError('')
    setSmartAlert(null)
    setVitalityStatus('loading')
    setVitalityError('')
    setVitalityScore(null)
    setVitalityExplanation('')

    try {
      const signals = await fetchOpenMeteoSignals(coords.latitude, coords.longitude, { correlationId })
      const fallback = buildSmartAlertFallback(
        {
          ...signals,
        },
        t
      )

      const alertJson = await generateSmartAlert({
        latitude: coords.latitude,
        longitude: coords.longitude,
        weatherSummary: signals,
        next48hHourly: signals?.next48hHourly,
        lang,
        correlationId,
      })
      const vitalityJson = await generateSoilVitalityScore({ weatherSummary: signals, lang, correlationId })

      // If Gemini fails to parse, or returns parseError, fall back to deterministic advice.
      if (alertJson?.parseError) {
        setSmartAlert(fallback)
      } else {
        setSmartAlert(alertJson)
      }
      setSmartStatus('success')

      const effectiveAlert = alertJson?.parseError ? fallback : alertJson
      const frostDetected =
        Boolean(effectiveAlert?.riskType === 'frost' || effectiveAlert?.isCritical) ||
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
          priority: effectiveAlert?.isCritical ? 'critical' : 'normal',
          riskType: effectiveAlert?.riskType || 'unknown',
          frostDetected,
          usedAi: !alertJson?.parseError,
        },
        { correlationId }
      )

      if (vitalityJson?.parseError) {
        const scoreFallback = buildSoilVitalityScoreFallback(signals, lang)
        setVitalityScore(applyActivityImpact(scoreFallback.soilHealthScore))
        setVitalityExplanation(
          `${scoreFallback.explanation}\n\n${t('vitality.activityImpactPrefix')} +${activityImpactPoints}`
        )
      } else {
        const score = vitalityJson?.soilHealthScore
        const explanation = vitalityJson?.explanation
        if (typeof score === 'number') setVitalityScore(applyActivityImpact(score))
        if (typeof explanation === 'string' && explanation.trim()) {
          setVitalityExplanation(
            `${explanation}\n\n${t('vitality.activityImpactPrefix')} +${activityImpactPoints}`
          )
        }
      }
      setVitalityStatus('success')

      uiLog.info(
        'ui.soilVitality.scoreSummary',
        {
          weatherHumidityBucket: signals?.humidityBucket || 'unknown',
          sunBucket: signals?.sunBucket || 'unknown',
          activityImpactPoints,
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

        const soilScoreForTasks =
          vitalityJson?.parseError
            ? buildSoilVitalityScoreFallback(signals, lang).soilHealthScore
            : vitalityJson?.soilHealthScore

        try {
          const dailyJson = await generateDailyTasks({
            weatherSummary: signals,
            soilHealthScore: soilScoreForTasks,
            lang,
            correlationId,
          })

          const tasksCandidate = dailyJson?.tasks
          const tasks =
            Array.isArray(tasksCandidate) && tasksCandidate.length === 3
              ? tasksCandidate
              : buildDailyTasksFallback(signals, t)
          const taskSource =
            Array.isArray(tasksCandidate) && tasksCandidate.length === 3 ? 'ai' : 'fallback'

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
          const tasks = buildDailyTasksFallback(signals, t)
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
      // Weather/Gemini failed: still keep UI stable and show deterministic advice from whatever we can.
      const fallback = buildSmartAlertFallback({}, t)
      setSmartAlert(fallback)
      setSmartStatus('success')

      // Score fallback is deterministic from whatever signals we have (may be empty).
      const scoreFallback = buildSoilVitalityScoreFallback({}, lang)
      setVitalityScore(applyActivityImpact(scoreFallback.soilHealthScore))
      setVitalityExplanation(
        `${scoreFallback.explanation}\n\n${t('vitality.activityImpactPrefix')} +${activityImpactPoints}`
      )
      setVitalityStatus('success')

      setSmartError(err?.message ? err.message : String(err))
      setVitalityError(err?.message ? err.message : String(err))

      if (dailyTasks.length === 0 && !dailyTasksGenerationInFlightRef.current) {
        const tasks = buildDailyTasksFallback({}, t)
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
        await runAdvice()
        await runSmartAlert()
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
      await runAdvice()
      await runSmartAlert()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords, geoStatus])

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
      await runAdvice()
      await runSmartAlert()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang])

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
                    <BadgeCheck size={16} strokeWidth={2.2} />
                    <span className="green-score-label">{t('dashboard.greenScore')}</span>
                    <span className="green-score-value">{greenScore}</span>
                  </div>
                  <div className="green-level-pill">
                    <span className="muted" style={{ opacity: 0.95, fontSize: 12 }}>
                      {t('dashboard.sustainabilityLevel')}
                    </span>
                    <span className="green-level-value">{greenLevel.name}</span>
                  </div>
                </div>

                {geoStatus !== 'success' ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-inline request-location-btn"
                    onClick={requestLocation}
                    disabled={geoStatus === 'loading'}
                  >
                    {geoStatus === 'error' ? t('common.retryLocation') : t('common.requestLocation')}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost btn-inline"
                  style={{ marginTop: 10 }}
                  onClick={() => {
                    uiLog.info('ui.modal.profile', { action: 'open' })
                    setSoilTypeDraft(profile?.soilType || 'loam')
                    setProfileOpen(true)
                  }}
                >
                  {t('profile.manageProfile')}
                </button>
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
                        : t('common.requestLocationEnable')}
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
                        {smartAlert.headline || '—'}
                      </p>
                      {smartAlert.recommendedAction ? (
                        <p className="smart-action">{smartAlert.recommendedAction}</p>
                      ) : null}
                      {smartAlert.actionPlan ? (
                        <p className="smart-action">
                          <strong>{t('common.actionPlan')}</strong> {smartAlert.actionPlan}
                        </p>
                      ) : null}
                      {smartAlert.details ? (
                        <p className="muted smart-details">{smartAlert.details}</p>
                      ) : null}
                      {Array.isArray(smartAlert.tags) && smartAlert.tags.length ? (
                        <div className="chips chips-tight">
                          {smartAlert.tags.slice(0, 4).map((t) => (
                            <span key={t} className="chip">
                              {t}
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
                    <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                      {ACTIVITY_TYPES.map((act) => (
                        <button
                          key={act.id}
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => addActivity(act.id)}
                        >
                          {t(`activity.types.${act.id}`)}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <div style={{ marginTop: 14 }}>
                    <p className="section-title">{t('activity.recentActivities')}</p>
                    {recentActivities.length ? (
                      <ul className="ordered-list">
                        {recentActivities.slice(0, 7).map((item) => (
                          <li key={item.id}>
                            {t(`activity.types.${item.activityTypeId}`)} -{' '}
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

                {geoStatus !== 'success' ? (
                  <div className="card-body">
                    <p className="muted">{t('common.enableLocationForAdvice')}</p>
                  </div>
                ) : null}

                {aiStatus === 'loading' ? (
                  <div className="card-body">
                    <p className="muted">{t('common.generatingNextStepPlan')}</p>
                  </div>
                ) : null}

                {aiStatus === 'error' ? (
                  <div className="card-body">
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

          {activeTab === 'compost' ? (
            <section className="dashboard">
              <header className="dashboard-header">
                <h1 className="dashboard-title">{t('tabs.compost')}</h1>
                <p className="dashboard-subtitle">{t('dashboard.compostHeaderSubtitle')}</p>
              </header>
              <section className="card">
                <div className="card-body">
                  <CompostWizard
                    onRecipeGenerated={() => addGreenPoints(10)}
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
            <PlantScanner lang={lang} />
          ) : null}
        </div>

        {profileOpen ? (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.22)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1200,
              padding: 16,
            }}
          >
            <section className="card" style={{ width: '100%', maxWidth: 480 }}>
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

                <p className="muted" style={{ marginTop: 10 }}>
                  {typeof coords?.latitude === 'number' && typeof coords?.longitude === 'number'
                    ? `${t('profile.locationSaved')}: ${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`
                    : t('profile.locationNotSaved')}
                </p>

                <div className="key-actions">
                  <button type="button" className="btn btn-primary" onClick={saveProfileDraft}>
                    {t('profile.saveProfile')}
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

