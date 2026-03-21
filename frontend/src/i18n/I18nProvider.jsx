import { useCallback, useEffect, useMemo, useState } from 'react'
import translations, {
  getTranslationsForLang,
} from './translations'
import { getAllLangs } from './translations'
import { getLanguageNativeLabel } from './languages'
import { I18nContext } from './I18nContext'

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
    try {
      localStorage.setItem('soilsense.lang', lang)
    } catch {
      // ignore
    }
  }, [lang])

  const setLang = useCallback(
    (next) => {
      const normalized = String(next || '').trim().toLowerCase()
      if (!availableLangs.includes(normalized)) return
      setLangState(normalized)
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
        return enV == null ? humanizeKey(key) : enV
      }
      return v
    },
    [dict]
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

