import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import SoilSenseApp from './SoilSenseApp.jsx'
import I18nProvider from './i18n/I18nProvider.jsx'
import { createLogger, normalizeErrorForLog } from './lib/logger'
import GuideTour from './components/GuideTour.jsx'
import { useI18n } from './i18n/useI18n'
import {
  addUserField,
  getUserById,
  loginWithEmail,
  logoutSession,
  markTourCompleted,
  requestPasswordReset,
  resetPasswordWithToken,
  restoreSession,
  getRememberedEmail,
  setUserActiveField,
  signUpWithEmail,
  updateFieldLocation,
} from './lib/auth'
import { installScopedLocalStorage, toScopedStorageKey } from './lib/storageScope'
import { geocodeFieldAddress } from './lib/geocoding'

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
      equipment: { shovel: false, tractor: false, sprinkler: false, dripIrrigation: false },
      updatedAt: new Date().toISOString(),
    }
    localStorage.setItem(scopedKey, JSON.stringify(payload))
  } catch {
    // best effort seeding
  }
}

function ScopedAppStorage({ userId, fieldId, children }) {
  useEffect(() => {
    const restore = installScopedLocalStorage(`soilsense.u.${userId}.f.${fieldId}.`)
    return restore
  }, [userId, fieldId])
  return children
}

function AuthScreen({ onAuthenticated }) {
  const { t, lang, changeLanguage, availableLangs, getLanguageNativeLabel } = useI18n()
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState(() => getRememberedEmail())
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [resetToken, setResetToken] = useState(() => {
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

  useEffect(() => {
    if (resetToken) setMode('reset')
  }, [resetToken])

  async function submit(event) {
    event.preventDefault()
    setErrorText('')
    setIsSubmitting(true)
    try {
      if (mode === 'reset') {
        await resetPasswordWithToken(resetToken, password)
        setMode('login')
        setPassword('')
        window.location.hash = ''
      } else if (mode === 'signup') {
        const session = await signUpWithEmail({ email, password, rememberMe })
        onAuthenticated(session)
      } else {
        const session = await loginWithEmail({ email, password, rememberMe })
        onAuthenticated(session)
      }
    } catch (err) {
      setErrorText(err?.message ? String(err.message) : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  function onForgotPassword() {
    const res = requestPasswordReset(email)
    setResetSentLink(res.link || '')
    if (email && res.link) {
      const subject = encodeURIComponent('SoilSense password reset link')
      const body = encodeURIComponent(`Use this link to reset your password:\n\n${res.link}`)
      window.open(`mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`, '_blank')
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
          <input className="field-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required={mode !== 'reset'} disabled={mode === 'reset'} />
        </label>
        {mode === 'login' ? (
          <>
            {!rememberMe ? (
              <label className="field">
                <span className="field-label">{tl('auth.password', 'Password')}</span>
                <input className="field-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
              </label>
            ) : null}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
              <span>{tl('auth.rememberMe', 'Remember me')}</span>
            </label>
          </>
        ) : (
          <label className="field">
            <span className="field-label">{tl('auth.password', 'Password')}</span>
            <input className="field-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
          </label>
        )}
        {errorText ? <pre className="error-pre">{errorText}</pre> : null}
        {resetSentLink ? (
          <div className="muted">
            {tl('auth.resetSent', 'Reset link prepared for your email:')}{' '}
            <a href={resetSentLink}>{tl('auth.openResetLink', 'Open reset link')}</a>
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

function FirstFieldSetup({ session, onDone }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [soilType, setSoilType] = useState('loam')
  const [sizeValue, setSizeValue] = useState('')
  const [sizeUnit, setSizeUnit] = useState('ha')
  const [address, setAddress] = useState('')
  const [errorText, setErrorText] = useState('')
  const [isResolvingAddress, setIsResolvingAddress] = useState(false)

  async function submit() {
    setErrorText('')
    try {
      setIsResolvingAddress(true)
      let manualLocation = {}
      if (address.trim()) {
        try {
          const geo = await geocodeFieldAddress(address)
          manualLocation = { latitude: geo.latitude, longitude: geo.longitude }
        } catch (err) {
          setErrorText(err?.message ? String(err.message) : String(err))
        }
      }
      addUserField(session.userId, {
        name,
        soilType,
        fieldSize: { value: parseNumberOrNull(sizeValue), unit: sizeUnit },
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
            <input className="field-input" value={sizeValue} onChange={(e) => setSizeValue(e.target.value)} inputMode="decimal" />
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
        {errorText ? <pre className="error-pre">{errorText}</pre> : null}
        <div className="key-actions">
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={isResolvingAddress}>
            {isResolvingAddress ? t('common.loading') : t('fields.saveField')}
          </button>
        </div>
      </div>
    </section>
  )
}

function AppRoot() {
  const { t } = useI18n()
  const [session, setSession] = useState(() => restoreSession())
  const [userRefreshSeq, setUserRefreshSeq] = useState(0)
  const [showAddField, setShowAddField] = useState(false)
  const [newFieldName, setNewFieldName] = useState('')
  const [newFieldSoilType, setNewFieldSoilType] = useState('loam')
  const [newFieldSizeValue, setNewFieldSizeValue] = useState('')
  const [newFieldSizeUnit, setNewFieldSizeUnit] = useState('ha')
  const [newFieldAddress, setNewFieldAddress] = useState('')
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

  const user = useMemo(() => {
    if (!session?.userId) return null
    return getUserById(session.userId)
  }, [session, userRefreshSeq])

  const fields = Array.isArray(user?.fields) ? user.fields : []
  const activeField =
    fields.find((f) => f.id === user?.activeFieldId) ||
    (fields.length ? fields[0] : null)

  const shouldShowTour = Boolean(user && activeField && !user.hasCompletedTour)
  const [showTour, setShowTour] = useState(shouldShowTour)

  useEffect(() => {
    setShowTour(shouldShowTour)
  }, [shouldShowTour, activeField?.id, user?.id])

  useEffect(() => {
    if (!session?.userId || !activeField?.id) return
    ensureScopedProfileSeed(session.userId, activeField)
  }, [session?.userId, activeField])

  useEffect(() => {
    if (showTour) return
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
  }, [showTour, session?.userId, activeField?.id])

  const handleTourClose = useCallback(() => {
    if (user?.id) markTourCompleted(user.id)
    setShowTour(false)
    setLocationSetupOpen(true)
    setUserRefreshSeq((x) => x + 1)
  }, [user?.id])

  function switchField(fieldId) {
    if (!session?.userId) return
    setUserActiveField(session.userId, fieldId)
    const nextUser = getUserById(session.userId)
    const nextField = (Array.isArray(nextUser?.fields) ? nextUser.fields : []).find((f) => f.id === fieldId)
    if (nextField) ensureScopedProfileSeed(session.userId, nextField)
    setUserRefreshSeq((x) => x + 1)
  }

  async function createField() {
    if (!session?.userId) return
    setFieldError('')
    try {
      let manualLocation = {}
      if (newFieldAddress.trim()) {
        try {
          const geo = await geocodeFieldAddress(newFieldAddress)
          manualLocation = { latitude: geo.latitude, longitude: geo.longitude }
        } catch (err) {
          setFieldError(err?.message ? String(err.message) : String(err))
        }
      }
      const field = addUserField(session.userId, {
        name: newFieldName,
        soilType: newFieldSoilType,
        fieldSize: {
          value: parseNumberOrNull(newFieldSizeValue),
          unit: newFieldSizeUnit,
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
    } catch (err) {
      setFieldError(err?.message ? String(err.message) : String(err))
    }
  }

  if (!session?.userId) {
    return <AuthScreen onAuthenticated={setSession} />
  }

  if (session?.userId && fields.length === 0) {
    return <FirstFieldSetup session={session} onDone={() => setUserRefreshSeq((x) => x + 1)} />
  }

  function saveScopedLocation(next) {
    if (!session?.userId || !activeField?.id) return
    const scopedKey = toScopedStorageKey(session.userId, activeField.id, PROFILE_STORAGE_KEY)
    try {
      const raw = localStorage.getItem(scopedKey)
      const base = raw ? JSON.parse(raw) : {}
      const payload = {
        ...base,
        address: typeof next.address === 'string' ? next.address : base?.address || '',
        latitude: next.latitude,
        longitude: next.longitude,
        updatedAt: new Date().toISOString(),
      }
      localStorage.setItem(scopedKey, JSON.stringify(payload))
      updateFieldLocation(session.userId, activeField.id, next)
      setUserRefreshSeq((x) => x + 1)
      setLocationSetupOpen(false)
    } catch {
      // no-op
    }
  }

  return (
    <>
      <section className="card" style={{ maxWidth: 900, margin: '0 auto 14px' }}>
        <div className="card-body" style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <label className="field" style={{ margin: 0, flex: 1, minWidth: 220 }}>
              <span className="field-label">{tl('fields.activeField', 'Active Field')}</span>
              <select className="field-input" value={activeField?.id || ''} onChange={(e) => switchField(e.target.value)}>
                {fields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-primary" onClick={() => setShowAddField((v) => !v)}>
              {tl('fields.addField', 'Add Field')}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                logoutSession()
                setSession(null)
              }}
            >
              {tl('auth.logout', 'Logout')}
            </button>
          </div>
          {!fields.length ? (
            <p className="muted">{tl('fields.emptyState', 'No fields yet. Add your first field to start.')}</p>
          ) : null}
          {showAddField ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <label className="field" style={{ margin: 0 }}>
                <span className="field-label">{tl('fields.fieldName', 'Field Name')}</span>
                <input className="field-input" value={newFieldName} onChange={(e) => setNewFieldName(e.target.value)} placeholder={tl('fields.fieldNameExample', 'e.g., North Plot')} />
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
                    <input className="field-input" value={newFieldSizeValue} onChange={(e) => setNewFieldSizeValue(e.target.value)} inputMode="decimal" />
                    <select className="field-input" value={newFieldSizeUnit} onChange={(e) => setNewFieldSizeUnit(e.target.value)} style={{ width: 100 }}>
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
              {fieldError ? <pre className="error-pre">{fieldError}</pre> : null}
              <div className="key-actions">
                <button type="button" className="btn btn-primary" onClick={() => void createField()}>
                  {tl('fields.saveField', 'Save Field')}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setShowAddField(false)}>
                  {tl('common.cancel', 'Cancel')}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {activeField ? (
        <ScopedAppStorage userId={session.userId} fieldId={activeField.id}>
          <SoilSenseApp key={`${session.userId}:${activeField.id}`} />
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
                            saveScopedLocation({
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
                        saveScopedLocation({
                          latitude: parseNumberOrNull(locationLat),
                          longitude: parseNumberOrNull(locationLon),
                          address: locationAddress,
                        })
                      }
                    >
                      {tl('fields.saveField', 'Save Field')}
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
    </>
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
