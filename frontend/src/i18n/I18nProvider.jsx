import { useCallback, useEffect, useMemo, useState } from 'react'
import translations, {
  getTranslationsForLang,
} from './translations'
import { getAllLangs } from './translations'
import { getLanguageNativeLabel } from './languages'
import { I18nContext } from './I18nContext'
import { createLogger } from '../lib/logger'

const i18nLog = createLogger('i18n')

/** Dedupe missing-key warns in dev (same session) to avoid spam when lists re-render. */
const missingKeyWarnSeen = new Set()

function logMissingTranslation(meta) {
  if (import.meta.env.PROD) {
    i18nLog.debug('i18n.missingKey', meta)
    return
  }
  const dedupeKey = `${meta.lang}|${meta.key}|${meta.fallback}`
  if (missingKeyWarnSeen.has(dedupeKey)) return
  missingKeyWarnSeen.add(dedupeKey)
  i18nLog.warn('i18n.missingKey', meta)
}

function getInitialLang() {
  try {
    const stored = localStorage.getItem('soilsense.lang')
    if (stored && getAllLangs().includes(stored)) return stored
  } catch {
    // ignore
  }

  try {
    const nav = navigator?.language?.toLowerCase?.() || 'en'
    if (nav.startsWith('tr')) return 'tr'
    if (nav.startsWith('de')) return 'de'
    if (nav.startsWith('es')) return 'es'
    if (nav.startsWith('zh')) return 'zh'
  } catch {
    // ignore
  }

  return 'en'
}

function tByPath(obj, path) {
  if (!path) return ''
  const parts = String(path).split('.')
  let cur = obj
  for (const p of parts) {
    if (cur == null) return null
    cur = cur[p]
  }
  return typeof cur === 'string' ? cur : cur
}

function humanizeKey(key) {
  const raw = String(key || '')
  const leaf = raw.includes('.') ? raw.split('.').pop() : raw
  const spaced = leaf.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
  const trimmed = spaced.trim()
  if (!trimmed) return raw
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

export default function I18nProvider({ children } = {}) {
  const [lang, setLangState] = useState(getInitialLang())

  const availableLangs = useMemo(() => getAllLangs(), [])

  useEffect(() => {
    const initial = getInitialLang()
    let source = 'default'
    try {
      const stored = localStorage.getItem('soilsense.lang')
      if (stored && getAllLangs().includes(stored)) {
        source = 'storage'
      } else {
        source = 'browser'
      }
    } catch {
      source = 'default'
    }
    i18nLog.info('i18n.init', { lang: initial, source })
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('soilsense.lang', lang)
    } catch (err) {
      i18nLog.warn('i18n.persistLangFailed', { message: err?.message ? String(err.message) : String(err) })
    }
  }, [lang])

  const setLang = useCallback(
    (next) => {
      const normalized = String(next || '').trim().toLowerCase()
      if (!availableLangs.includes(normalized)) return
      setLangState((prev) => {
        if (prev === normalized) return prev
        i18nLog.info('i18n.changeLanguage', { from: prev, to: normalized })
        return normalized
      })
    },
    [availableLangs]
  )

  const dict = useMemo(() => getTranslationsForLang(lang), [lang])

  const t = useCallback(
    (key) => {
      // Fallback to english if a key doesn't exist.
      const v = tByPath(dict, key)
      if (v == null) {
        const enDict = translations.en
        const enV = tByPath(enDict, key)
        if (enV == null) {
          logMissingTranslation({ key, lang, fallback: 'humanize' })
          return humanizeKey(key)
        }
        logMissingTranslation({ key, lang, fallback: 'en' })
        return enV
      }
      return v
    },
    [dict, lang]
  )

  const value = useMemo(
    () => ({
      lang,
      setLang,
      changeLanguage: setLang,
      t,
      availableLangs,
      getLanguageNativeLabel,
    }),
    [lang, setLang, t, availableLangs]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

