import { StrictMode, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import SoilSenseApp from './SoilSenseApp.jsx'
import I18nProvider from './i18n/I18nProvider.jsx'
import { createLogger, normalizeErrorForLog } from './lib/logger'
import GuideTour from './components/GuideTour.jsx'
import { useI18n } from './i18n/useI18n'
import { Globe2, X } from 'lucide-react'
import {
  addUserField,
  bootstrapAuth,
  clearRemoteUserCache,
  completeRemotePasswordRecovery,
  deleteUserField,
  getUserById,
  hydrateRemoteSessionAfterAuth,
  isRemoteAuthEnabled,
  loginWithEmail,
  logoutSession,
  markProjectIntroDismissed,
  markTourCompleted,
  requestPasswordReset,
  resetPasswordWithToken,
  restoreSession,
  getRememberedEmail,
  getRememberedPassword,
  getRememberMePreference,
  setRememberMePreference,
  getKnownAccountEmails,
  normalizeEmail,
  setUserActiveField,
  signUpWithEmail,
  updateUserField,
  updateFieldLocation,
} from './lib/auth'
import { getSupabaseClient } from './lib/supabaseClient.js'
import { installScopedLocalStorage, toScopedStorageKey } from './lib/storageScope'
import { geocodeFieldAddress, coordinatesIndicateWater } from './lib/geocoding'
import {
  fieldAreaHectares,
  isRealisticFieldAreaHa,
  parseStrictPositiveFieldSize,
} from './lib/fieldValidation'

const appLog = createLogger('app')
const pwaLog = createLogger('pwa')
const PROFILE_STORAGE_KEY = 'soilsense.profile'

function parseNumberOrNull(value) {
  const n = Number(String(value || '').trim())
  return Number.isFinite(n) ? n : null
}

function ensureScopedProfileSeed(userId, field) {
  if (!userId || !field?.id) return
  try {
    const scopedKey = toScopedStorageKey(userId, field.id, PROFILE_STORAGE_KEY)
    const existing = localStorage.getItem(scopedKey)
    if (existing) return
    const payload = {
      soilType: field.soilType || 'loam',
      address: typeof field.address === 'string' ? field.address : '',
      latitude: typeof field.manualLocation?.latitude === 'number' ? field.manualLocation.latitude : null,
      longitude: typeof field.manualLocation?.longitude === 'number' ? field.manualLocation.longitude : null,
      fieldSize: {
        value: typeof field.fieldSize?.value === 'number' ? field.fieldSize.value : null,
        unit: field.fieldSize?.unit === 'sqm' ? 'sqm' : 'ha',
      },
      workforce: null,
      currentCrops: [],
      customCrops: [],
      equipment: { shovel: false, tractor: false, sprinkler: false, dripIrrigation: false },
      updatedAt: new Date().toISOString(),
    }
    localStorage.setItem(scopedKey, JSON.stringify(payload))
  } catch {
    // best effort seeding
  }
}

function syncScopedProfileFromField(userId, field) {
  if (!userId || !field?.id) return
  try {
    const scopedKey = toScopedStorageKey(userId, field.id, PROFILE_STORAGE_KEY)
    const existingRaw = localStorage.getItem(scopedKey)
    const existing = existingRaw ? JSON.parse(existingRaw) : {}
    const payload = {
      ...existing,
      soilType: field.soilType || existing?.soilType || 'loam',
      // Keep per-field scoped location persistent across reloads/switches.
      // If scoped data already has a location, prefer it over auth-db field defaults.
      address:
        typeof existing?.address === 'string' && existing.address.trim()
          ? existing.address
          : typeof field.address === 'string'
            ? field.address
            : '',
      latitude:
        typeof existing?.latitude === 'number'
          ? existing.latitude
          : typeof field.manualLocation?.latitude === 'number'
            ? field.manualLocation.latitude
            : null,
      longitude:
        typeof existing?.longitude === 'number'
          ? existing.longitude
          : typeof field.manualLocation?.longitude === 'number'
            ? field.manualLocation.longitude
            : null,
      fieldSize: {
        value:
          typeof field.fieldSize?.value === 'number'
            ? field.fieldSize.value
            : typeof existing?.fieldSize?.value === 'number'
              ? existing.fieldSize.value
              : null,
        unit: field.fieldSize?.unit === 'sqm' ? 'sqm' : existing?.fieldSize?.unit === 'sqm' ? 'sqm' : 'ha',
      },
      updatedAt: new Date().toISOString(),
    }
    localStorage.setItem(scopedKey, JSON.stringify(payload))
  } catch {
    // best effort sync
  }
}

function clearScopedFieldStorage(userId, fieldId) {
  if (!userId || !fieldId) return
  const prefix = `soilsense.u.${userId}.f.${fieldId}.`
  try {
    const localKeys = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)
      if (typeof k === 'string' && k.startsWith(prefix)) localKeys.push(k)
    }
    for (const k of localKeys) localStorage.removeItem(k)
  } catch {
    // best effort local cleanup
  }
  try {
    const sessionKeys = []
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const k = sessionStorage.key(i)
      if (typeof k === 'string' && k.startsWith(prefix)) sessionKeys.push(k)
    }
    for (const k of sessionKeys) sessionStorage.removeItem(k)
  } catch {
    // best effort session cleanup
  }
}

function ScopedAppStorage({ userId, fieldId, children }) {
  const [scopeReady, setScopeReady] = useState(false)

  // Install the storage scope before paint so the dashboard never flashes empty (null).
  useLayoutEffect(() => {
    const restore = installScopedLocalStorage(`soilsense.u.${userId}.f.${fieldId}.`)
    // Must flip after installScopedLocalStorage() so children only read scoped keys.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional two-phase mount for localStorage proxy
    setScopeReady(true)
    return () => {
      restore()
      setScopeReady(false)
    }
  }, [userId, fieldId])
  return scopeReady ? children : null
}

function AuthScreen({ onAuthenticated, remoteRecovery }) {
  const { t, lang, changeLanguage, availableLangs, getLanguageNativeLabel } = useI18n()
  const knownAccountEmails = useMemo(() => getKnownAccountEmails(), [])
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(() => getRememberMePreference())
  const [resetToken] = useState(() => {
    const hash = String(window.location.hash || '')
    if (!hash.startsWith('#reset=')) return ''
    return decodeURIComponent(hash.slice('#reset='.length))
  })
  const [resetSentLink, setResetSentLink] = useState('')
  const [errorText, setErrorText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  function tl(key, fallback) {
    const v = t(key)
    return v === key ? fallback : v
  }

  function readAuthFormEmailPassword(form, stateEmail, statePassword) {
    const emailEl = form?.elements?.namedItem('auth-email')
    const passEl = form?.elements?.namedItem('auth-password')
    const emailRaw = emailEl && 'value' in emailEl ? emailEl.value : stateEmail
    const passRaw = passEl && 'value' in passEl ? passEl.value : statePassword
    return {
      email: normalizeEmail(emailRaw),
      password: String(passRaw ?? ''),
    }
  }

  useEffect(() => {
    if (resetToken) setMode('reset')
  }, [resetToken])

  useEffect(() => {
    if (remoteRecovery) setMode('reset')
  }, [remoteRecovery])

  useLayoutEffect(() => {
    const e = getRememberedEmail()
    const p = getRememberedPassword()
    if (e) setEmail(e)
    if (p) setPassword(p)
  }, [])

  async function submit(event) {
    event.preventDefault()
    setErrorText('')
    setIsSubmitting(true)
    try {
      const { email: formEmail, password: formPassword } = readAuthFormEmailPassword(
        event.currentTarget,
        email,
        password
      )
      if (formEmail) setEmail(formEmail)
      if (mode === 'login' || mode === 'signup') {
        if (formPassword) setPassword(formPassword)
      }
      if (mode === 'reset') {
        if (isRemoteAuthEnabled() && remoteRecovery) {
          await completeRemotePasswordRecovery(formPassword)
          const nextSession = await hydrateRemoteSessionAfterAuth()
          if (nextSession) onAuthenticated(nextSession)
          setMode('login')
          setPassword('')
        } else {
          await resetPasswordWithToken(resetToken, formPassword)
          setMode('login')
          setPassword('')
          window.location.hash = ''
        }
      } else if (mode === 'signup') {
        const session = await signUpWithEmail({ email: formEmail, password: formPassword, rememberMe })
        onAuthenticated(session)
      } else {
        const session = await loginWithEmail({ email: formEmail, password: formPassword, rememberMe })
        onAuthenticated(session)
      }
    } catch (err) {
      setErrorText(err?.message ? String(err.message) : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function onForgotPassword() {
    setErrorText('')
    try {
      const el = typeof document !== 'undefined' ? document.getElementById('auth-email') : null
      const raw = el && 'value' in el ? el.value : email
      const addr = normalizeEmail(raw)
      const res = await requestPasswordReset(addr)
      setResetSentLink(res.link || (isRemoteAuthEnabled() ? '__remote_sent__' : ''))
      if (addr && res.link) {
        const subject = encodeURIComponent('SoilSense password reset link')
        const body = encodeURIComponent(`Use this link to reset your password:\n\n${res.link}`)
        window.open(`mailto:${encodeURIComponent(addr)}?subject=${subject}&body=${body}`, '_blank')
      }
    } catch (err) {
      setErrorText(err?.message ? String(err.message) : String(err))
    }
  }

  return (
    <section className="card" style={{ maxWidth: 520, margin: '40px auto' }}>
      <div className="card-top">
        <div className="card-title-wrap">
          <h1 className="card-title">
            {mode === 'reset'
              ? tl('auth.resetPassword', 'Reset Password')
              : mode === 'signup'
                ? tl('auth.signUp', 'Sign Up')
                : tl('auth.login', 'Login')}
          </h1>
        </div>
        <div className="card-hint">
          {mode === 'reset'
            ? tl('auth.resetHint', 'Set a new password for your account.')
            : mode === 'signup'
            ? tl('auth.signUpHint', 'Create your account to start with an empty field workspace.')
            : tl('auth.loginHint', 'Sign in to access your fields and personalized data.')}
        </div>
      </div>
      <form className="card-body" onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <label className="field" style={{ marginTop: 0 }}>
          <span className="field-label">{tl('language.label', 'Language')}</span>
          <select
            className="field-input"
            value={lang}
            onChange={(e) => changeLanguage(e.target.value)}
          >
            {availableLangs.map((code) => (
              <option key={code} value={code}>
                {getLanguageNativeLabel(code)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{tl('auth.email', 'Email')}</span>
          <input
            id="auth-email"
            name="auth-email"
            className="field-input"
            type="email"
            autoComplete="email"
            list={mode !== 'reset' && knownAccountEmails.length ? 'auth-known-accounts' : undefined}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required={mode !== 'reset'}
            disabled={mode === 'reset'}
          />
          {mode !== 'reset' && knownAccountEmails.length ? (
            <datalist id="auth-known-accounts">
              {knownAccountEmails.map((addr) => (
                <option key={addr} value={addr} />
              ))}
            </datalist>
          ) : null}
          {knownAccountEmails.length ? (
            <span className="muted" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
              {tl('auth.knownAccountsHint', 'Pick a previously used email on this device, or type a new one.')}
            </span>
          ) : null}
        </label>
        {mode === 'login' ? (
          <>
            <label className="field">
              <span className="field-label">{tl('auth.password', 'Password')}</span>
              <input
                id="auth-password"
                name="auth-password"
                className="field-input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required={!rememberMe || (!password && !getRememberedPassword())}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => {
                  const on = e.target.checked
                  setRememberMe(on)
                  setRememberMePreference(on)
                }}
              />
              <span>{tl('auth.rememberMe', 'Remember me')}</span>
            </label>
          </>
        ) : (
          <label className="field">
            <span className="field-label">{tl('auth.password', 'Password')}</span>
            <input
              id="auth-password"
              name="auth-password"
              className="field-input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
        )}
        {errorText ? <pre className="error-pre">{errorText}</pre> : null}
        {resetSentLink ? (
          <div className="muted">
            {resetSentLink === '__remote_sent__' ? (
              tl(
                'auth.resetEmailSent',
                'If an account exists for that email, we sent a link to reset your password. Check your inbox.'
              )
            ) : (
              <>
                {tl('auth.resetSent', 'Reset link prepared for your email:')}{' '}
                <a href={resetSentLink}>{tl('auth.openResetLink', 'Open reset link')}</a>
              </>
            )}
          </div>
        ) : null}
        <div className="key-actions">
          <button className="btn btn-primary" type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? tl('auth.working', 'Working...')
              : mode === 'reset'
                ? tl('auth.resetPassword', 'Reset Password')
                : mode === 'signup'
                ? tl('auth.createAccount', 'Create account')
                : tl('auth.login', 'Login')}
          </button>
          {mode === 'login' ? (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setMode('signup')}>
                {tl('auth.noAccount', "Don't have an account? Sign up")}
              </button>
              <button type="button" className="btn btn-ghost" onClick={onForgotPassword}>
                {tl('auth.forgotPassword', 'Forgot password?')}
              </button>
            </>
          ) : null}
          {mode === 'signup' ? (
            <button type="button" className="btn btn-ghost" onClick={() => setMode('login')}>
              {tl('auth.haveAccount', 'Already have an account? Login')}
            </button>
          ) : null}
          {mode === 'reset' ? (
            <button type="button" className="btn btn-ghost" onClick={() => setMode('login')}>
              {tl('auth.backToLogin', 'Back to login')}
            </button>
          ) : null}
        </div>
      </form>
    </section>
  )
}

function FirstFieldSetup({ session, onDone, onLogout }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [soilType, setSoilType] = useState('loam')
  const [sizeValue, setSizeValue] = useState('')
  const [sizeUnit, setSizeUnit] = useState('ha')
  const [address, setAddress] = useState('')
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')
  const [errorText, setErrorText] = useState('')
  const [isResolvingAddress, setIsResolvingAddress] = useState(false)

  async function submit() {
    setErrorText('')
    try {
      setIsResolvingAddress(true)
      let manualLocation = {
        latitude: parseNumberOrNull(lat),
        longitude: parseNumberOrNull(lon),
      }
      if (address.trim() && !(typeof manualLocation.latitude === 'number' && typeof manualLocation.longitude === 'number')) {
        try {
          const geo = await geocodeFieldAddress(address)
          manualLocation = { latitude: geo.latitude, longitude: geo.longitude }
        } catch (err) {
          setErrorText(err?.message ? String(err.message) : String(err))
          return
        }
      }

      const sizeParsed = parseStrictPositiveFieldSize(sizeValue)
      if (!sizeParsed.ok) {
        window.alert(t('fields.validation.sizeNumbersOnly'))
        return
      }
      const areaHa = fieldAreaHectares(sizeParsed.value, sizeUnit)
      if (!isRealisticFieldAreaHa(areaHa)) {
        window.alert(t('fields.validation.checkFieldSize'))
        return
      }

      if (typeof manualLocation.latitude === 'number' && typeof manualLocation.longitude === 'number') {
        const water = await coordinatesIndicateWater(manualLocation.latitude, manualLocation.longitude)
        if (water) {
          window.alert(t('fields.validation.selectLand'))
          return
        }
      }

      addUserField(session.userId, {
        name,
        soilType,
        fieldSize: { value: sizeParsed.value, unit: sizeUnit === 'sqm' ? 'sqm' : 'ha' },
        address,
        manualLocation,
      })
      onDone()
    } catch (err) {
      setErrorText(err?.message ? String(err.message) : String(err))
    } finally {
      setIsResolvingAddress(false)
    }
  }

  return (
    <section className="card" style={{ maxWidth: 720, margin: '30px auto' }}>
      <div className="card-top">
        <div className="card-title-wrap">
          <h2 className="card-title">{t('fields.firstFieldTitle') === 'fields.firstFieldTitle' ? 'Add your first field' : t('fields.firstFieldTitle')}</h2>
        </div>
      </div>
      <div className="card-body" style={{ display: 'grid', gap: 10 }}>
        <label className="field">
          <span className="field-label">{t('fields.fieldName')}</span>
          <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">{t('profile.soilTypeLabel')}</span>
          <select className="field-input" value={soilType} onChange={(e) => setSoilType(e.target.value)}>
            <option value="loam">{t('profile.soilTypes.loam')}</option>
            <option value="clay">{t('profile.soilTypes.clay')}</option>
            <option value="sandy">{t('profile.soilTypes.sandy')}</option>
            <option value="silty">{t('profile.soilTypes.silty')}</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t('profile.fieldSizeLabel')}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="field-input"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={sizeValue}
              onChange={(e) => setSizeValue(e.target.value)}
            />
            <select className="field-input" value={sizeUnit} onChange={(e) => setSizeUnit(e.target.value)} style={{ width: 120 }}>
              <option value="sqm">{t('profile.fieldSizeUnits.sqm')}</option>
              <option value="ha">{t('profile.fieldSizeUnits.ha')}</option>
            </select>
          </div>
        </label>
        <label className="field">
          <span className="field-label">{t('fields.fieldAddress') === 'fields.fieldAddress' ? 'Field Address' : t('fields.fieldAddress')}</span>
          <input className="field-input" value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
          <label className="field">
            <span className="field-label">{t('fields.manualLatitude', 'Manual Latitude')}</span>
            <input className="field-input" value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" />
          </label>
          <label className="field">
            <span className="field-label">{t('fields.manualLongitude', 'Manual Longitude')}</span>
            <input className="field-input" value={lon} onChange={(e) => setLon(e.target.value)} inputMode="decimal" />
          </label>
        </div>
        {errorText ? <pre className="error-pre">{errorText}</pre> : null}
        <div className="key-actions">
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={isResolvingAddress}>
            {isResolvingAddress ? t('common.loading') : t('fields.saveField')}
          </button>
          {typeof onLogout === 'function' ? (
            <button type="button" className="btn btn-ghost" onClick={onLogout}>
              {t('auth.logout') === 'auth.logout' ? 'Logout' : t('auth.logout')}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function AppRoot() {
  const { t, lang, changeLanguage, availableLangs, getLanguageNativeLabel } = useI18n()
  const [session, setSession] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [remoteRecovery, setRemoteRecovery] = useState(false)
  const [userRefreshSeq, setUserRefreshSeq] = useState(0)
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false)
  const [showAddField, setShowAddField] = useState(false)
  const [editingFieldId, setEditingFieldId] = useState('')
  const [newFieldName, setNewFieldName] = useState('')
  const [newFieldSoilType, setNewFieldSoilType] = useState('loam')
  const [newFieldSizeValue, setNewFieldSizeValue] = useState('')
  const [newFieldSizeUnit, setNewFieldSizeUnit] = useState('ha')
  const [newFieldAddress, setNewFieldAddress] = useState('')
  const [newFieldLat, setNewFieldLat] = useState('')
  const [newFieldLon, setNewFieldLon] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [locationSetupOpen, setLocationSetupOpen] = useState(false)
  const [locationAddress, setLocationAddress] = useState('')
  const [locationLat, setLocationLat] = useState('')
  const [locationLon, setLocationLon] = useState('')
  const [locationResolveError, setLocationResolveError] = useState('')
  const [isResolvingLocationAddress, setIsResolvingLocationAddress] = useState(false)

  function tl(key, fallback) {
    const v = t(key)
    return v === key ? fallback : v
  }

  useEffect(() => {
    if (!isRemoteAuthEnabled()) {
      try {
        setSession(restoreSession())
      } catch (err) {
        appLog.error('app.auth.restoreSession.failed', normalizeErrorForLog(err), {})
        setSession(null)
      }
      setAuthReady(true)
      return
    }
    let cancelled = false
    const AUTH_BOOTSTRAP_TIMEOUT_MS = 25000
    void Promise.race([
      bootstrapAuth(),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Sign-in check timed out. Check your network and Supabase settings.'))
        }, AUTH_BOOTSTRAP_TIMEOUT_MS)
      }),
    ])
      .then(({ session: s }) => {
        if (!cancelled) setSession(s)
      })
      .catch((err) => {
        appLog.error('app.auth.bootstrap.failed', normalizeErrorForLog(err), {})
        if (!cancelled) setSession(null)
      })
      .finally(() => {
        if (!cancelled) setAuthReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isRemoteAuthEnabled()) return
    const sb = getSupabaseClient()
    if (!sb) return
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        clearRemoteUserCache()
        setRemoteRecovery(true)
        setSession(null)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session?.userId) setRemoteRecovery(false)
  }, [session?.userId])

  const handleLogout = useCallback(() => {
    void (async () => {
      await logoutSession()
      window.location.reload()
    })()
  }, [])

  const user = useMemo(
    () => {
      if (!session?.userId) return null
      return getUserById(session.userId)
    },
    // userRefreshSeq bumps when profile mutates without changing session (tour, fields, etc.).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- need userRefreshSeq + session?.userId together
    [session?.userId, userRefreshSeq],
  )

  const fields = Array.isArray(user?.fields) ? user.fields : []
  const activeField =
    fields.find((f) => f.id === user?.activeFieldId) ||
    (fields.length ? fields[0] : null)

  const activeFieldSoilTypeLabel =
    typeof activeField?.soilType === 'string' ? t(`profile.soilTypes.${activeField.soilType}`) : '—'

  const activeFieldSizeText =
    typeof activeField?.fieldSize?.value === 'number' && Number.isFinite(activeField.fieldSize.value)
      ? `${activeField.fieldSize.value} ${
          activeField.fieldSize?.unit === 'sqm' ? t('profile.fieldSizeUnits.sqm') : t('profile.fieldSizeUnits.ha')
        }`
      : '—'

  const activeFieldLocationText =
    typeof activeField?.address === 'string' && activeField.address.trim()
      ? activeField.address.trim()
      : typeof activeField?.manualLocation?.latitude === 'number' &&
          typeof activeField?.manualLocation?.longitude === 'number'
        ? `${activeField.manualLocation.latitude}, ${activeField.manualLocation.longitude}`
        : '—'

  const shouldShowProjectIntro = Boolean(
    user && activeField && !user.hasSeenProjectIntro && !user.hasCompletedTour
  )
  const shouldShowTour = Boolean(
    user && activeField && !user.hasCompletedTour && user.hasSeenProjectIntro
  )
  const [showProjectIntro, setShowProjectIntro] = useState(shouldShowProjectIntro)
  const [showTour, setShowTour] = useState(shouldShowTour)

  // Track current SoilSense tab so we can adjust surrounding layout.
  // Default to dashboard until SoilSenseApp reports otherwise.
  const [currentSoilSenseTab, setCurrentSoilSenseTab] = useState('dashboard')

  useEffect(() => {
    setShowProjectIntro(shouldShowProjectIntro)
  }, [shouldShowProjectIntro, activeField?.id, user?.id])

  useEffect(() => {
    setShowTour(shouldShowTour)
  }, [shouldShowTour, activeField?.id, user?.id])

  useEffect(() => {
    if (!session?.userId || !activeField?.id) return
    ensureScopedProfileSeed(session.userId, activeField)
  }, [session?.userId, activeField])

  useEffect(() => {
    if (showTour) return
    if (!user?.hasSeenProjectIntro) return
    if (!session?.userId || !activeField?.id) return
    try {
      const scopedKey = toScopedStorageKey(session.userId, activeField.id, PROFILE_STORAGE_KEY)
      const raw = localStorage.getItem(scopedKey)
      const parsed = raw ? JSON.parse(raw) : null
      const missingCoords = !(typeof parsed?.latitude === 'number' && typeof parsed?.longitude === 'number')
      if (missingCoords) setLocationSetupOpen(true)
    } catch {
      setLocationSetupOpen(true)
    }
  }, [showTour, user?.hasSeenProjectIntro, session?.userId, activeField?.id])

  useEffect(() => {
    if (!session?.userId || !activeField?.id) return
    const scopedKey = toScopedStorageKey(session.userId, activeField.id, PROFILE_STORAGE_KEY)
    let parsed = null
    try {
      const raw = localStorage.getItem(scopedKey)
      parsed = raw ? JSON.parse(raw) : null
    } catch {
      parsed = null
    }
    const fieldAddress =
      typeof parsed?.address === 'string'
        ? parsed.address
        : typeof activeField.address === 'string'
          ? activeField.address
          : ''
    const fieldLat =
      typeof parsed?.latitude === 'number'
        ? parsed.latitude
        : typeof activeField?.manualLocation?.latitude === 'number'
          ? activeField.manualLocation.latitude
          : null
    const fieldLon =
      typeof parsed?.longitude === 'number'
        ? parsed.longitude
        : typeof activeField?.manualLocation?.longitude === 'number'
          ? activeField.manualLocation.longitude
          : null
    setLocationAddress(fieldAddress)
    setLocationLat(fieldLat == null ? '' : String(fieldLat))
    setLocationLon(fieldLon == null ? '' : String(fieldLon))
    setLocationResolveError('')
  }, [session?.userId, activeField?.id, activeField?.address, activeField?.manualLocation?.latitude, activeField?.manualLocation?.longitude])

  const handleProjectIntroClose = useCallback(() => {
    if (user?.id) markProjectIntroDismissed(user.id)
    setShowProjectIntro(false)
    setUserRefreshSeq((x) => x + 1)
  }, [user?.id])

  const handleTourClose = useCallback(() => {
    if (user?.id) markTourCompleted(user.id)
    setShowTour(false)
    setLocationSetupOpen(true)
    setUserRefreshSeq((x) => x + 1)
  }, [user?.id])

  function switchField(fieldId) {
    if (!session?.userId) return
    if (!fieldId || fieldId === activeField?.id) return
    setUserActiveField(session.userId, fieldId)
    const nextUser = getUserById(session.userId)
    const nextField = (Array.isArray(nextUser?.fields) ? nextUser.fields : []).find((f) => f.id === fieldId)
    if (nextField) {
      ensureScopedProfileSeed(session.userId, nextField)
      syncScopedProfileFromField(session.userId, nextField)
      const nextAddress = typeof nextField.address === 'string' ? nextField.address : ''
      const nextLat =
        typeof nextField?.manualLocation?.latitude === 'number'
          ? String(nextField.manualLocation.latitude)
          : ''
      const nextLon =
        typeof nextField?.manualLocation?.longitude === 'number'
          ? String(nextField.manualLocation.longitude)
          : ''
      setLocationAddress(nextAddress)
      setLocationLat(nextLat)
      setLocationLon(nextLon)
      setLocationResolveError('')
      setLocationSetupOpen(false)
    }
    setUserRefreshSeq((x) => x + 1)
    // Force fresh boot on selected field scope so stale previous-field location cannot persist.
    window.setTimeout(() => {
      window.location.reload()
    }, 60)
  }

  async function createField() {
    if (!session?.userId) return
    setFieldError('')
    try {
      let manualLocation = {
        latitude: parseNumberOrNull(newFieldLat),
        longitude: parseNumberOrNull(newFieldLon),
      }
      if (
        newFieldAddress.trim() &&
        !(typeof manualLocation.latitude === 'number' && typeof manualLocation.longitude === 'number')
      ) {
        try {
          const geo = await geocodeFieldAddress(newFieldAddress)
          manualLocation = { latitude: geo.latitude, longitude: geo.longitude }
        } catch (err) {
          setFieldError(err?.message ? String(err.message) : String(err))
          return
        }
      }

      const sizeParsed = parseStrictPositiveFieldSize(newFieldSizeValue)
      if (!sizeParsed.ok) {
        window.alert(tl('fields.validation.sizeNumbersOnly', 'Please enter the field size as a number'))
        return
      }
      const areaHa = fieldAreaHectares(sizeParsed.value, newFieldSizeUnit)
      if (!isRealisticFieldAreaHa(areaHa)) {
        window.alert(tl('fields.validation.checkFieldSize', 'Please check the size of the field'))
        return
      }

      if (typeof manualLocation.latitude === 'number' && typeof manualLocation.longitude === 'number') {
        const water = await coordinatesIndicateWater(manualLocation.latitude, manualLocation.longitude)
        if (water) {
          window.alert(tl('fields.validation.selectLand', 'Please select land'))
          return
        }
      }

      const field = addUserField(session.userId, {
        name: newFieldName,
        soilType: newFieldSoilType,
        fieldSize: {
          value: sizeParsed.value,
          unit: newFieldSizeUnit === 'sqm' ? 'sqm' : 'ha',
        },
        address: newFieldAddress,
        manualLocation,
      })
      ensureScopedProfileSeed(session.userId, field)
      setUserRefreshSeq((x) => x + 1)
      setShowAddField(false)
      setNewFieldName('')
      setNewFieldSoilType('loam')
      setNewFieldSizeValue('')
      setNewFieldSizeUnit('ha')
      setNewFieldAddress('')
      setNewFieldLat('')
      setNewFieldLon('')
    } catch (err) {
      setFieldError(err?.message ? String(err.message) : String(err))
    }
  }

  function startEditField() {
    if (!activeField) return
    setEditingFieldId(activeField.id)
    setShowAddField(true)
    setFieldError('')
    setNewFieldName(activeField.name || '')
    setNewFieldSoilType(activeField.soilType || 'loam')
    setNewFieldSizeValue(
      typeof activeField.fieldSize?.value === 'number' ? String(activeField.fieldSize.value) : ''
    )
    setNewFieldSizeUnit(activeField.fieldSize?.unit === 'sqm' ? 'sqm' : 'ha')
    setNewFieldAddress(typeof activeField.address === 'string' ? activeField.address : '')
    setNewFieldLat(
      typeof activeField?.manualLocation?.latitude === 'number'
        ? String(activeField.manualLocation.latitude)
        : ''
    )
    setNewFieldLon(
      typeof activeField?.manualLocation?.longitude === 'number'
        ? String(activeField.manualLocation.longitude)
        : ''
    )
  }

  async function saveEditedField() {
    if (!session?.userId || !editingFieldId) return
    setFieldError('')
    try {
      let manualLocation = {
        latitude: parseNumberOrNull(newFieldLat),
        longitude: parseNumberOrNull(newFieldLon),
      }
      if (
        newFieldAddress.trim() &&
        !(typeof manualLocation.latitude === 'number' && typeof manualLocation.longitude === 'number')
      ) {
        try {
          const geo = await geocodeFieldAddress(newFieldAddress)
          manualLocation = { latitude: geo.latitude, longitude: geo.longitude }
        } catch (err) {
          setFieldError(err?.message ? String(err.message) : String(err))
          return
        }
      }

      const sizeParsed = parseStrictPositiveFieldSize(newFieldSizeValue)
      if (!sizeParsed.ok) {
        window.alert(tl('fields.validation.sizeNumbersOnly', 'Please enter the field size as a number'))
        return
      }
      const areaHa = fieldAreaHectares(sizeParsed.value, newFieldSizeUnit)
      if (!isRealisticFieldAreaHa(areaHa)) {
        window.alert(tl('fields.validation.checkFieldSize', 'Please check the size of the field'))
        return
      }

      if (typeof manualLocation.latitude === 'number' && typeof manualLocation.longitude === 'number') {
        const water = await coordinatesIndicateWater(manualLocation.latitude, manualLocation.longitude)
        if (water) {
          window.alert(tl('fields.validation.selectLand', 'Please select land'))
          return
        }
      }

      const updated = updateUserField(session.userId, editingFieldId, {
        name: newFieldName,
        soilType: newFieldSoilType,
        fieldSize: {
          value: sizeParsed.value,
          unit: newFieldSizeUnit === 'sqm' ? 'sqm' : 'ha',
        },
        address: newFieldAddress,
        manualLocation,
      })
      if (!updated) throw new Error('Unable to update field.')
      ensureScopedProfileSeed(session.userId, updated)
      syncScopedProfileFromField(session.userId, updated)
      if (activeField?.id === editingFieldId) {
        await saveScopedLocation({
          latitude: manualLocation.latitude,
          longitude: manualLocation.longitude,
          address: newFieldAddress,
        })
      }
      setUserRefreshSeq((x) => x + 1)
      setShowAddField(false)
      setEditingFieldId('')
      setNewFieldName('')
      setNewFieldSoilType('loam')
      setNewFieldSizeValue('')
      setNewFieldSizeUnit('ha')
      setNewFieldAddress('')
      setNewFieldLat('')
      setNewFieldLon('')
    } catch (err) {
      setFieldError(err?.message ? String(err.message) : String(err))
    }
  }

  function removeActiveField() {
    if (!session?.userId || !activeField?.id) return
    if (!window.confirm(`Delete field "${activeField.name}"? This cannot be undone.`)) return
    const removed = deleteUserField(session.userId, activeField.id)
    if (!removed) return
    clearScopedFieldStorage(session.userId, activeField.id)
    setShowAddField(false)
    setEditingFieldId('')
    setFieldError('')
    setLocationAddress('')
    setLocationLat('')
    setLocationLon('')
    setLocationResolveError('')
    setUserRefreshSeq((x) => x + 1)
  }

  if (!authReady) {
    return (
      <div className="card" style={{ maxWidth: 520, margin: '40px auto' }}>
        <p className="card-hint" style={{ margin: 0 }}>
          {tl('common.loading', 'Loading…')}
        </p>
      </div>
    )
  }

  if (!session?.userId) {
    return <AuthScreen onAuthenticated={setSession} remoteRecovery={remoteRecovery} />
  }

  if (session?.userId && fields.length === 0) {
    return (
      <FirstFieldSetup
        session={session}
        onDone={() => setUserRefreshSeq((x) => x + 1)}
        onLogout={handleLogout}
      />
    )
  }

  async function saveScopedLocation(next) {
    if (!session?.userId || !activeField?.id) return
    try {
      let latitude = typeof next?.latitude === 'number' ? next.latitude : null
      let longitude = typeof next?.longitude === 'number' ? next.longitude : null
      const trimmedAddress = typeof next?.address === 'string' ? next.address.trim() : ''
      if (!(typeof latitude === 'number' && typeof longitude === 'number') && trimmedAddress) {
        try {
          setIsResolvingLocationAddress(true)
          const geo = await geocodeFieldAddress(trimmedAddress)
          latitude = geo.latitude
          longitude = geo.longitude
        } catch (err) {
          // Keep manual save possible even if geocoding provider fails.
          setLocationResolveError(err?.message ? String(err.message) : String(err))
        } finally {
          setIsResolvingLocationAddress(false)
        }
      }
      if (typeof latitude === 'number' && typeof longitude === 'number') {
        const water = await coordinatesIndicateWater(latitude, longitude)
        if (water) {
          window.alert(tl('fields.validation.selectLand', 'Please select land'))
          return
        }
      }
      // This function is called from inside ScopedAppStorage, so use the base key.
      // The scoped storage wrapper will map it to the active field automatically.
      const raw = localStorage.getItem(PROFILE_STORAGE_KEY)
      const base = raw ? JSON.parse(raw) : {}
      const payload = {
        ...base,
        address: trimmedAddress || base?.address || '',
        latitude,
        longitude,
        updatedAt: new Date().toISOString(),
      }
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(payload))
      updateFieldLocation(session.userId, activeField.id, {
        address: payload.address,
        latitude: payload.latitude,
        longitude: payload.longitude,
      })
      setLocationLat(payload.latitude == null ? '' : String(payload.latitude))
      setLocationLon(payload.longitude == null ? '' : String(payload.longitude))
      setUserRefreshSeq((x) => x + 1)
      setLocationSetupOpen(false)
    } catch {
      // no-op
    }
  }

  function renderMyFieldForm() {
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <label className="field" style={{ margin: 0 }}>
          <span className="field-label">{tl('fields.fieldName', 'Field Name')}</span>
          <input
            className="field-input"
            value={newFieldName}
            onChange={(e) => setNewFieldName(e.target.value)}
            placeholder={tl('fields.fieldNameExample', 'e.g., North Plot')}
          />
        </label>

        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
          <label className="field" style={{ margin: 0 }}>
            <span className="field-label">{tl('profile.soilTypeLabel', 'Soil Type')}</span>
            <select className="field-input" value={newFieldSoilType} onChange={(e) => setNewFieldSoilType(e.target.value)}>
              <option value="loam">{t('profile.soilTypes.loam')}</option>
              <option value="clay">{t('profile.soilTypes.clay')}</option>
              <option value="sandy">{t('profile.soilTypes.sandy')}</option>
              <option value="silty">{t('profile.soilTypes.silty')}</option>
            </select>
          </label>

          <label className="field" style={{ margin: 0 }}>
            <span className="field-label">{tl('profile.fieldSizeLabel', 'Field Size')}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="field-input"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={newFieldSizeValue}
                onChange={(e) => setNewFieldSizeValue(e.target.value)}
              />
              <select
                className="field-input"
                value={newFieldSizeUnit}
                onChange={(e) => setNewFieldSizeUnit(e.target.value)}
                style={{ width: 100 }}
              >
                <option value="sqm">{t('profile.fieldSizeUnits.sqm')}</option>
                <option value="ha">{t('profile.fieldSizeUnits.ha')}</option>
              </select>
            </div>
          </label>
        </div>

        <label className="field" style={{ margin: 0 }}>
          <span className="field-label">{tl('fields.fieldAddress', 'Field Address')}</span>
          <input className="field-input" value={newFieldAddress} onChange={(e) => setNewFieldAddress(e.target.value)} />
        </label>

        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
          <label className="field" style={{ margin: 0 }}>
            <span className="field-label">{tl('fields.manualLatitude', 'Manual Latitude')}</span>
            <input
              className="field-input"
              value={newFieldLat}
              onChange={(e) => setNewFieldLat(e.target.value)}
              inputMode="decimal"
            />
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span className="field-label">{tl('fields.manualLongitude', 'Manual Longitude')}</span>
            <input
              className="field-input"
              value={newFieldLon}
              onChange={(e) => setNewFieldLon(e.target.value)}
              inputMode="decimal"
            />
          </label>
        </div>

        {fieldError ? <pre className="error-pre">{fieldError}</pre> : null}

        <div className="key-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => (editingFieldId ? void saveEditedField() : void createField())}
          >
            {editingFieldId ? tl('fields.updateField', 'Update Field') : tl('fields.saveField', 'Save Field')}
          </button>
          {editingFieldId ? (
            <button type="button" className="btn btn-ghost" onClick={removeActiveField}>
              {tl('fields.deleteField', 'Delete Field')}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setShowAddField(false)
              setEditingFieldId('')
            }}
          >
            {tl('common.cancel', 'Cancel')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="app-session-layout">
      <div className="app-session-scroll">
        {session?.userId ? (
          <header className="app-session-header" role="banner">
            <div className="lang-dropdown-anchor">
              <button
                type="button"
                className="lang-icon-btn"
                onClick={() => setIsLangMenuOpen((v) => !v)}
                aria-label={t('language.label')}
                aria-expanded={isLangMenuOpen}
                style={{ padding: '6px 10px' }}
              >
                <Globe2 size={16} strokeWidth={2.2} className="lang-icon" />
                <span className="lang-current">{getLanguageNativeLabel(lang || 'en')}</span>
              </button>

              {isLangMenuOpen ? (
                <div className="lang-menu lang-menu-open" role="menu" aria-label={t('language.label')}>
                  {availableLangs.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className={id === lang ? 'lang-menu-item lang-menu-item-active' : 'lang-menu-item'}
                      onClick={() => {
                        changeLanguage(id)
                        setIsLangMenuOpen(false)
                      }}
                      role="menuitem"
                    >
                      {getLanguageNativeLabel(id)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <button
              type="button"
              className="btn btn-ghost"
              aria-label={t('auth.logout')}
              onClick={() => {
                setIsLangMenuOpen(false)
                const ok = window.confirm(t('auth.logoutConfirm', 'Logout?'))
                if (ok) handleLogout()
              }}
              style={{ fontSize: 20, lineHeight: 1, fontWeight: 800, width: 34, height: 34 }}
            >
              ×
            </button>
          </header>
        ) : null}

      {/* Welcome should be directly above the My Fields panel */}
      {activeField && currentSoilSenseTab !== 'guide' ? (
        <div style={{ textAlign: 'center', margin: '12px auto 12px', maxWidth: 1220, padding: '0 16px' }}>
          <h1 className="dashboard-title" style={{ margin: 0, fontSize: 26, lineHeight: 1.15 }}>
            {t('dashboard.welcomeBackFarmer')}
          </h1>
        </div>
      ) : null}

      {currentSoilSenseTab !== 'guide' ? (
      <section className="card" style={{ maxWidth: 1220, margin: '0 auto 14px' }}>
        <div className="card-body" style={{ display: 'grid', gap: 10 }}>
          <div
            style={{
              display: 'grid',
              gap: 10,
              gridTemplateColumns: 'minmax(620px, 1.45fr) minmax(360px, 1fr)',
              alignItems: 'start',
            }}
          >
            <section
              style={{
                border: '1px solid rgba(26, 67, 50, 0.14)',
                borderRadius: 12,
                padding: 10,
                background: 'rgba(124, 166, 137, 0.05)',
              }}
              aria-label={tl('fields.myfFieldsTitle', 'myf fields')}
            >
              <p className="field-label" style={{ marginBottom: 10, fontWeight: 900, fontSize: 16 }}>
                {tl('fields.myfFieldsTitle', 'My Fields')}
              </p>

              <div style={{ display: 'grid', gap: 10 }}>
                <label className="field" style={{ margin: 0 }}>
                  <span className="field-label">{tl('fields.activeField', 'Active Field')}</span>
                  <select className="field-input" value={activeField?.id || ''} onChange={(e) => switchField(e.target.value)}>
                    {fields.map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setShowAddField((v) => {
                        const next = !v
                        if (!next) {
                          setEditingFieldId('')
                        } else {
                          setEditingFieldId('')
                          setFieldError('')
                          setNewFieldName('')
                          setNewFieldSoilType('loam')
                          setNewFieldSizeValue('')
                          setNewFieldSizeUnit('ha')
                          setNewFieldAddress('')
                          setNewFieldLat('')
                          setNewFieldLon('')
                        }
                        return next
                      })
                    }}
                  >
                    {tl('fields.addField', 'Add Field')}
                  </button>
                </div>

                {!fields.length ? (
                  <p className="muted">{tl('fields.emptyState', 'No fields yet. Add your first field to start.')}</p>
                ) : null}
              </div>
            </section>

            <section
              style={{
                border: '1px solid rgba(26, 67, 50, 0.14)',
                borderRadius: 12,
                padding: 10,
                background: 'rgba(124, 166, 137, 0.05)',
              }}
              aria-label={tl('fields.activeField', 'Active Field')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                <p className="field-label" style={{ marginBottom: 6 }}>
                  {tl('fields.activeField', 'Active Field')}
                </p>
              </div>

              {activeField ? (
                <>
                  <p className="field-label" style={{ marginBottom: 8 }}>
                    {activeField.name}
                  </p>
                  <p className="muted" style={{ margin: 0, lineHeight: 1.4 }}>
                    {activeFieldSoilTypeLabel} • {activeFieldSizeText}
                    <br />
                    {activeFieldLocationText}
                  </p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                    <button type="button" className="btn btn-ghost btn-inline" onClick={startEditField}>
                      {tl('fields.editField', 'Edit Field')}
                    </button>
                    <button type="button" className="btn btn-ghost btn-inline" onClick={removeActiveField}>
                      {tl('fields.deleteField', 'Delete Field')}
                    </button>
                  </div>
                </>
              ) : (
                <p className="muted">{tl('fields.emptyState', 'No fields yet. Add your first field to start.')}</p>
              )}
            </section>
          </div>
        </div>
      </section>
      ) : null}

      {activeField ? (
        <ScopedAppStorage userId={session.userId} fieldId={activeField.id}>
          <SoilSenseApp
            key={`${session.userId}:${activeField.id}`}
            hideWelcomeHeader
            onActiveTabChange={setCurrentSoilSenseTab}
          />
          {showProjectIntro ? (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="project-intro-title"
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.25)',
                zIndex: 2620,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16,
              }}
            >
              <section className="card" style={{ width: '100%', maxWidth: 520, position: 'relative' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  aria-label={tl('projectIntro.close', 'Close')}
                  onClick={handleProjectIntroClose}
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    width: 40,
                    height: 40,
                    padding: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <X size={22} strokeWidth={2} aria-hidden="true" />
                </button>
                <div className="card-top" style={{ paddingRight: 48 }}>
                  <div className="card-title-wrap">
                    <h3 id="project-intro-title" className="card-title">
                      {tl('projectIntro.title', 'Welcome to SoilSense AI')}
                    </h3>
                  </div>
                </div>
                <div className="card-body">
                  <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>
                    {tl(
                      'projectIntro.body',
                      'SoilSense AI helps you understand soil health, plan crops and compost, interpret plant scans, and track daily tasks for your fields—all in one place. Close this message to continue with a short tour of the app.'
                    )}
                  </p>
                </div>
              </section>
            </div>
          ) : null}
          <GuideTour open={showTour} onClose={handleTourClose} />
          {locationSetupOpen ? (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.25)',
                zIndex: 2600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16,
              }}
            >
              <section className="card" style={{ width: '100%', maxWidth: 560 }}>
                <div className="card-top">
                  <div className="card-title-wrap">
                    <h3 className="card-title">{tl('fields.locationSetupTitle', 'Set field location')}</h3>
                  </div>
                  <div className="card-hint">
                    {tl('fields.locationSetupHint', 'Enter your field address to set location and local analysis context.')}
                  </div>
                </div>
                <div className="card-body" style={{ display: 'grid', gap: 10 }}>
                  <label className="field" style={{ margin: 0 }}>
                    <span className="field-label">{tl('fields.fieldAddress', 'Field Address')}</span>
                    <input className="field-input" value={locationAddress} onChange={(e) => setLocationAddress(e.target.value)} />
                  </label>
                  {locationResolveError ? <pre className="error-pre">{locationResolveError}</pre> : null}
                  <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
                    <label className="field" style={{ margin: 0 }}>
                      <span className="field-label">{tl('fields.manualLatitude', 'Manual Latitude')}</span>
                      <input className="field-input" value={locationLat} onChange={(e) => setLocationLat(e.target.value)} inputMode="decimal" />
                    </label>
                    <label className="field" style={{ margin: 0 }}>
                      <span className="field-label">{tl('fields.manualLongitude', 'Manual Longitude')}</span>
                      <input className="field-input" value={locationLon} onChange={(e) => setLocationLon(e.target.value)} inputMode="decimal" />
                    </label>
                  </div>
                  <div className="key-actions">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={isResolvingLocationAddress || !locationAddress.trim()}
                      onClick={() => {
                        setLocationResolveError('')
                        setIsResolvingLocationAddress(true)
                        void geocodeFieldAddress(locationAddress)
                          .then((geo) => {
                            setLocationLat(String(geo.latitude))
                            setLocationLon(String(geo.longitude))
                            void saveScopedLocation({
                              latitude: geo.latitude,
                              longitude: geo.longitude,
                              address: locationAddress,
                            })
                          })
                          .catch((err) => {
                            setLocationResolveError(err?.message ? String(err.message) : String(err))
                          })
                          .finally(() => setIsResolvingLocationAddress(false))
                      }}
                    >
                      {isResolvingLocationAddress ? tl('common.loading', 'Loading...') : tl('fields.useAddressLookup', 'Use address lookup')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() =>
                        void saveScopedLocation({
                          latitude: parseNumberOrNull(locationLat),
                          longitude: parseNumberOrNull(locationLon),
                          address: locationAddress,
                        })
                      }
                    >
                      {tl('fields.updateLocation', 'Update Location')}
                    </button>
                  </div>
                </div>
              </section>
            </div>
          ) : null}
        </ScopedAppStorage>
      ) : (
        <section className="card" style={{ maxWidth: 900, margin: '0 auto' }}>
          <div className="card-body">
            <p className="muted">{tl('fields.firstFieldPrompt', 'Create your first field to enter the dashboard.')}</p>
          </div>
        </section>
      )}

      {showAddField ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="field-form-dialog-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.25)',
            zIndex: 2590,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowAddField(false)
              setEditingFieldId('')
            }
          }}
        >
          <section
            className="card"
            style={{ width: '100%', maxWidth: 560, maxHeight: 'min(90vh, 720px)', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-top" style={{ flexShrink: 0 }}>
              <div className="card-title-wrap">
                <h3 id="field-form-dialog-title" className="card-title">
                  {editingFieldId ? tl('fields.editField', 'Edit Field') : tl('fields.addField', 'Add Field')}
                </h3>
              </div>
            </div>
            <div className="card-body" style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
              {renderMyFieldForm()}
            </div>
          </section>
        </div>
      ) : null}
      </div>
    </div>
  )
}

/** Avoid logging arbitrary postMessage payloads (SW may send structured data later). */
function sanitizeServiceWorkerMessageData(data) {
  if (data == null) return null
  if (typeof data === 'string') {
    return data.length > 200 ? `${data.slice(0, 200)}…` : data
  }
  if (typeof data === 'object') {
    const t = data?.type
    return {
      type: typeof t === 'string' ? t : '[non-string]',
      keyCount: Object.keys(data).length,
    }
  }
  return { kind: typeof data }
}

function sanitizeGlobalMessage(msg) {
  if (msg == null) return ''
  const s = String(msg)
  if (/AIza[0-9A-Za-z_-]{10,}/.test(s)) return '[redacted: possible API key in message]'
  return s.length > 800 ? `${s.slice(0, 800)}…` : s
}

window.addEventListener('error', (event) => {
  appLog.error(
    'app.global.error',
    {
      message: sanitizeGlobalMessage(event?.message),
      filename: event?.filename,
      lineno: event?.lineno,
      colno: event?.colno,
    },
    {}
  )
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason
  const err = reason instanceof Error ? reason : new Error(sanitizeGlobalMessage(reason))
  appLog.error('app.global.unhandledrejection', normalizeErrorForLog(err), {})
})

// PWA readiness: register SW only in production.
// In local dev, actively remove old SW/caches to avoid stale UI bundles.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (ev) => {
    pwaLog.info('pwa.sw.message', { data: sanitizeServiceWorkerMessageData(ev?.data) })
  })

  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      pwaLog.info('pwa.sw.register.start', { path: '/sw.js' })
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          pwaLog.info('pwa.sw.register.success', { scope: reg.scope })
        })
        .catch((err) => {
          pwaLog.warn('pwa.sw.register.failed', normalizeErrorForLog(err))
        })
    })
  } else {
    window.addEventListener('load', () => {
      pwaLog.info('pwa.dev.unregisterCaches.start', {})
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => r.unregister())
        pwaLog.info('pwa.dev.unregisterCaches.done', { registrations: regs.length })
      })
      if ('caches' in window) {
        caches.keys().then((keys) => {
          const targets = keys.filter((k) => k.startsWith('soilsense-pwa-'))
          targets.forEach((k) => caches.delete(k))
          pwaLog.info('pwa.dev.cacheCleared', { keysDeleted: targets.length })
        })
      }
    })
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nProvider>
      <AppRoot />
    </I18nProvider>
  </StrictMode>,
)
