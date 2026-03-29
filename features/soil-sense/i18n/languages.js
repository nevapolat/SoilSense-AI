export const SUPPORTED_LANGS = [
  { id: 'en', label: 'English', nativeLabel: 'English' },
  { id: 'tr', label: 'Turkish', nativeLabel: 'Türkçe' },
  { id: 'de', label: 'German', nativeLabel: 'Deutsch' },
  { id: 'es', label: 'Spanish', nativeLabel: 'Castellano' },
  { id: 'zh', label: 'Chinese', nativeLabel: '中文（简体）' },
]

export function getLanguageNativeLabel(id) {
  return SUPPORTED_LANGS.find((l) => l.id === id)?.nativeLabel || 'English'
}

export function getLanguageDisplayName(id) {
  // LLM prompt-friendly language names.
  const m = {
    en: 'English',
    tr: 'Turkish',
    de: 'German',
    es: 'Spanish',
    zh: 'Simplified Chinese',
  }
  return m[id] || 'English'
}

