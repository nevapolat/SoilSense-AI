import { createLogger, normalizeErrorForLog } from './logger'

const weatherLog = createLogger('weather')

/**
 * Fetches normalized weather signals from Open-Meteo (kept in its own module so production
 * minifier names cannot collide with Lucide icon bindings in SoilSenseApp).
 */
export async function fetchOpenMeteoSignals(latitude, longitude, { correlationId } = {}) {
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
