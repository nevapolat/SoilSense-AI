import { createContext } from 'react'
import { getLanguageNativeLabel } from './languages'

export const I18nContext = createContext({
  lang: 'en',
  setLang: () => {},
  changeLanguage: () => {},
  t: (key) => key,
  availableLangs: [],
  getLanguageNativeLabel,
})

