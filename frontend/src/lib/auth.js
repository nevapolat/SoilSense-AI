const AUTH_DB_KEY = 'soilsense.auth.db.v1'
const AUTH_DB_MIRROR_KEY = 'soilsense.auth.db.mirror.v1'
const AUTH_SESSION_KEY = 'soilsense.auth.session.v1'
const AUTH_RESET_KEY = 'soilsense.auth.reset.v1'
const DEVICE_ID_KEY = 'soilsense.auth.deviceId.v1'
const AUTH_REMEMBERED_EMAIL_KEY = 'soilsense.auth.rememberedEmail.v1'
const AUTH_REMEMBERED_PASSWORD_KEY = 'soilsense.auth.rememberedPassword.v1'

/** Captured at module load before installScopedLocalStorage() replaces localStorage methods. */
const W = typeof window !== 'undefined' ? window : null
const nativeLocalGet = W?.localStorage?.getItem?.bind(W.localStorage)
const nativeLocalSet = W?.localStorage?.setItem?.bind(W.localStorage)
const nativeLocalRemove = W?.localStorage?.removeItem?.bind(W.localStorage)
const nativeSessionGet = W?.sessionStorage?.getItem?.bind(W.sessionStorage)
const nativeSessionSet = W?.sessionStorage?.setItem?.bind(W.sessionStorage)
const nativeSessionRemove = W?.sessionStorage?.removeItem?.bind(W.sessionStorage)

function authLocalGet(key) {
  if (nativeLocalGet) return nativeLocalGet(key)
  if (!W?.localStorage) return null
  return Storage.prototype.getItem.call(W.localStorage, key)
}
function authLocalSet(key, value) {
  if (nativeLocalSet) nativeLocalSet(key, value)
  else if (W?.localStorage) Storage.prototype.setItem.call(W.localStorage, key, value)
}
function authLocalRemove(key) {
  if (nativeLocalRemove) nativeLocalRemove(key)
  else if (W?.localStorage) Storage.prototype.removeItem.call(W.localStorage, key)
}
function authSessionGet(key) {
  if (nativeSessionGet) return nativeSessionGet(key)
  if (!W?.sessionStorage) return null
  return Storage.prototype.getItem.call(W.sessionStorage, key)
}
function authSessionSet(key, value) {
  if (nativeSessionSet) nativeSessionSet(key, value)
  else if (W?.sessionStorage) Storage.prototype.setItem.call(W.sessionStorage, key, value)
}
function authSessionRemove(key) {
  if (nativeSessionRemove) nativeSessionRemove(key)
  else if (W?.sessionStorage) Storage.prototype.removeItem.call(W.sessionStorage, key)
}

function toBase64(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function fromBase64(value) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function makeId(prefix) {
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${Date.now().toString(36)}_${rand}`
}

function getDeviceId() {
  try {
    const existing = authLocalGet(DEVICE_ID_KEY)
    if (existing) return existing
    const created = makeId('dev')
    authLocalSet(DEVICE_ID_KEY, created)
    return created
  } catch {
    return makeId('dev')
  }
}

function setRememberedEmail(email) {
  const normalized = normalizeEmail(email)
  if (!normalized) return
  authLocalSet(AUTH_REMEMBERED_EMAIL_KEY, normalized)
}

function clearRememberedEmail() {
  authLocalRemove(AUTH_REMEMBERED_EMAIL_KEY)
}

function setRememberedPassword(password) {
  const raw = String(password || '')
  if (!raw) return
  authLocalSet(AUTH_REMEMBERED_PASSWORD_KEY, raw)
}

function clearRememberedPassword() {
  authLocalRemove(AUTH_REMEMBERED_PASSWORD_KEY)
}

export function getRememberedPassword() {
  try {
    return String(authLocalGet(AUTH_REMEMBERED_PASSWORD_KEY) || '')
  } catch {
    return ''
  }
}

export function getRememberedEmail() {
  try {
    return normalizeEmail(authLocalGet(AUTH_REMEMBERED_EMAIL_KEY) || '')
  } catch {
    return ''
  }
}

function loadDb() {
  let users = []
  try {
    const raw = authLocalGet(AUTH_DB_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.users)) {
        users = parsed.users
      }
    }
  } catch {
    users = []
  }

  if (users.length === 0) {
    try {
      const mirrorRaw = authSessionGet(AUTH_DB_MIRROR_KEY)
      if (mirrorRaw) {
        const parsed = JSON.parse(mirrorRaw)
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.users) && parsed.users.length > 0) {
          users = parsed.users
          try {
            authLocalSet(AUTH_DB_KEY, JSON.stringify({ users }))
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // Recover accounts that were written under scoped keys before shared-key bypass existed.
  if (users.length === 0) {
    const merged = new Map()
    try {
      const ls = window.localStorage
      for (let i = 0; i < ls.length; i += 1) {
        const k = ls.key(i)
        if (typeof k !== 'string' || k === AUTH_DB_KEY) continue
        if (!k.endsWith(AUTH_DB_KEY)) continue
        const altRaw = authLocalGet(k)
        if (!altRaw) continue
        const altParsed = JSON.parse(altRaw)
        const altUsers = Array.isArray(altParsed?.users) ? altParsed.users : []
        for (const u of altUsers) {
          const ne = normalizeEmail(u?.email)
          if (ne && !merged.has(ne)) merged.set(ne, u)
        }
      }
    } catch {
      // ignore
    }
    if (merged.size > 0) {
      users = [...merged.values()]
      try {
        authLocalSet(AUTH_DB_KEY, JSON.stringify({ users }))
      } catch {
        // ignore
      }
    }
  }

  return { users }
}

function saveDb(db) {
  const serialized = JSON.stringify(db)
  authLocalSet(AUTH_DB_KEY, serialized)
  try {
    authSessionSet(AUTH_DB_MIRROR_KEY, serialized)
  } catch {
    // ignore (e.g. sessionStorage disabled)
  }
}

function getUserByEmail(db, email) {
  const normalized = normalizeEmail(email)
  return db.users.find((u) => normalizeEmail(u.email) === normalized) || null
}

export function getUserById(userId) {
  const db = loadDb()
  return db.users.find((u) => u.id === userId) || null
}

async function hashPassword(password, saltBase64, iterations = 120000) {
  const encoder = new TextEncoder()
  const baseKey = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: fromBase64(saltBase64),
      iterations,
    },
    baseKey,
    256
  )
  return toBase64(new Uint8Array(bits))
}

async function buildPasswordRecord(password) {
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  const saltBase64 = toBase64(salt)
  const iterations = 120000
  const hash = await hashPassword(password, saltBase64, iterations)
  return { salt: saltBase64, hash, iterations }
}

async function verifyPassword(password, record) {
  // Backward compatibility: older builds may have stored password as plain string.
  if (typeof record === 'string') return String(password || '') === record
  if (!record?.salt || !record?.hash) return false
  const computed = await hashPassword(password, record.salt, record.iterations || 120000)
  return computed === record.hash
}

export async function signUpWithEmail({ email, password, rememberMe }) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail.includes('@')) throw new Error('Invalid email address.')
  if (String(password || '').length < 8) throw new Error('Password must be at least 8 characters.')

  const db = loadDb()
  if (getUserByEmail(db, normalizedEmail)) {
    throw new Error('Account already exists for this email.')
  }

  const passwordRecord = await buildPasswordRecord(password)
  const deviceId = getDeviceId()
  const user = {
    id: makeId('usr'),
    email: normalizedEmail,
    password: passwordRecord,
    hasCompletedTour: false,
    activeFieldId: null,
    fields: [],
    trustedDeviceIds: rememberMe ? [deviceId] : [],
    createdAt: new Date().toISOString(),
  }
  db.users.push(user)
  saveDb(db)

  const session = {
    userId: user.id,
    rememberMe: Boolean(rememberMe),
    createdAt: new Date().toISOString(),
  }
  persistSession(session)
  if (rememberMe) {
    setRememberedEmail(normalizedEmail)
    setRememberedPassword(password)
  } else {
    clearRememberedEmail()
    clearRememberedPassword()
  }
  return session
}

export async function loginWithEmail({ email, password, rememberMe }) {
  const normalizedEmail = normalizeEmail(email) || (rememberMe ? getRememberedEmail() : '')
  if (!normalizedEmail) throw new Error('Email is required.')
  const db = loadDb()
  const user = getUserByEmail(db, normalizedEmail)
  if (!user) throw new Error('No account found for this email.')
  const deviceId = getDeviceId()
  const trusted = Array.isArray(user.trustedDeviceIds) && user.trustedDeviceIds.includes(deviceId)
  const needsPassword = !rememberMe || !trusted
  const passwordCandidate = String(password || '') || (rememberMe ? getRememberedPassword() : '')
  if (needsPassword) {
    if (!String(passwordCandidate || '')) {
      throw new Error('Password is required for this device.')
    }
    const ok = await verifyPassword(passwordCandidate, user.password)
    if (!ok) throw new Error('Invalid email or password.')
    // Migrate legacy plain-text password record on successful login.
    if (typeof user.password === 'string') {
      user.password = await buildPasswordRecord(passwordCandidate)
    }
    if (rememberMe) {
      user.trustedDeviceIds = Array.isArray(user.trustedDeviceIds) ? user.trustedDeviceIds : []
      if (!user.trustedDeviceIds.includes(deviceId)) user.trustedDeviceIds.push(deviceId)
    }
    saveDb(db)
  }
  const session = {
    userId: user.id,
    rememberMe: Boolean(rememberMe),
    createdAt: new Date().toISOString(),
  }
  persistSession(session)
  if (rememberMe) {
    setRememberedEmail(normalizedEmail)
    if (passwordCandidate) setRememberedPassword(passwordCandidate)
  } else {
    clearRememberedEmail()
    clearRememberedPassword()
  }
  return session
}

export function persistSession(session) {
  const serialized = JSON.stringify(session)
  authLocalRemove(AUTH_SESSION_KEY)
  authSessionRemove(AUTH_SESSION_KEY)
  if (session?.rememberMe) authLocalSet(AUTH_SESSION_KEY, serialized)
  else authSessionSet(AUTH_SESSION_KEY, serialized)
}

export function restoreSession() {
  let session = null
  try {
    const persistent = authLocalGet(AUTH_SESSION_KEY)
    if (persistent) session = JSON.parse(persistent)
  } catch {
    // ignore
  }
  if (!session) {
    try {
      const temporary = authSessionGet(AUTH_SESSION_KEY)
      if (temporary) session = JSON.parse(temporary)
    } catch {
      // ignore
    }
  }
  if (!session?.userId) return null
  const user = getUserById(session.userId)
  if (!user) {
    authLocalRemove(AUTH_SESSION_KEY)
    authSessionRemove(AUTH_SESSION_KEY)
    return null
  }
  return session
}

export function logoutSession() {
  authLocalRemove(AUTH_SESSION_KEY)
  authSessionRemove(AUTH_SESSION_KEY)
  // Remember-me is for the login form only; clear it so logout always lands on a fresh login (no auto-login).
  clearRememberedEmail()
  clearRememberedPassword()
}

export function listUserFields(userId) {
  const user = getUserById(userId)
  return Array.isArray(user?.fields) ? user.fields : []
}

export function addUserField(userId, fieldInput) {
  const db = loadDb()
  const user = db.users.find((u) => u.id === userId)
  if (!user) throw new Error('User not found.')
  const fieldName = String(fieldInput?.name || '').trim()
  if (!fieldName) throw new Error('Field name is required.')
  const field = {
    id: makeId('fld'),
    name: fieldName,
    soilType: String(fieldInput?.soilType || 'loam'),
    fieldSize: {
      value: typeof fieldInput?.fieldSize?.value === 'number' ? fieldInput.fieldSize.value : null,
      unit: fieldInput?.fieldSize?.unit === 'sqm' ? 'sqm' : 'ha',
    },
    manualLocation: {
      latitude: typeof fieldInput?.manualLocation?.latitude === 'number' ? fieldInput.manualLocation.latitude : null,
      longitude: typeof fieldInput?.manualLocation?.longitude === 'number' ? fieldInput.manualLocation.longitude : null,
    },
    address: typeof fieldInput?.address === 'string' ? fieldInput.address.trim() : '',
    createdAt: new Date().toISOString(),
  }
  const existing = Array.isArray(user.fields) ? user.fields : []
  user.fields = [...existing, field]
  user.activeFieldId = field.id
  saveDb(db)
  return field
}

export function setUserActiveField(userId, fieldId) {
  const db = loadDb()
  const user = db.users.find((u) => u.id === userId)
  if (!user) return
  if (!Array.isArray(user.fields) || !user.fields.some((f) => f.id === fieldId)) return
  user.activeFieldId = fieldId
  saveDb(db)
}

export function updateFieldLocation(userId, fieldId, input) {
  const db = loadDb()
  const user = db.users.find((u) => u.id === userId)
  if (!user || !Array.isArray(user.fields)) return null
  const field = user.fields.find((f) => f.id === fieldId)
  if (!field) return null
  field.manualLocation = {
    latitude: typeof input?.latitude === 'number' ? input.latitude : null,
    longitude: typeof input?.longitude === 'number' ? input.longitude : null,
  }
  if (typeof input?.address === 'string' && input.address.trim()) field.address = input.address.trim()
  saveDb(db)
  return field
}

export function updateUserField(userId, fieldId, fieldInput) {
  const db = loadDb()
  const user = db.users.find((u) => u.id === userId)
  if (!user || !Array.isArray(user.fields)) return null
  const field = user.fields.find((f) => f.id === fieldId)
  if (!field) return null

  const fieldName = String(fieldInput?.name || '').trim()
  if (fieldName) field.name = fieldName
  if (typeof fieldInput?.soilType === 'string' && fieldInput.soilType.trim()) {
    field.soilType = fieldInput.soilType.trim()
  }
  if (fieldInput?.fieldSize && typeof fieldInput.fieldSize === 'object') {
    field.fieldSize = {
      value: typeof fieldInput.fieldSize.value === 'number' ? fieldInput.fieldSize.value : null,
      unit: fieldInput.fieldSize.unit === 'sqm' ? 'sqm' : 'ha',
    }
  }
  if (typeof fieldInput?.address === 'string') {
    field.address = fieldInput.address.trim()
  }
  if (fieldInput?.manualLocation && typeof fieldInput.manualLocation === 'object') {
    field.manualLocation = {
      latitude:
        typeof fieldInput.manualLocation.latitude === 'number'
          ? fieldInput.manualLocation.latitude
          : null,
      longitude:
        typeof fieldInput.manualLocation.longitude === 'number'
          ? fieldInput.manualLocation.longitude
          : null,
    }
  }

  field.updatedAt = new Date().toISOString()
  saveDb(db)
  return field
}

export function deleteUserField(userId, fieldId) {
  const db = loadDb()
  const user = db.users.find((u) => u.id === userId)
  if (!user || !Array.isArray(user.fields)) return null

  const prevFields = user.fields
  const nextFields = prevFields.filter((f) => f.id !== fieldId)
  if (nextFields.length === prevFields.length) return null

  user.fields = nextFields
  if (user.activeFieldId === fieldId) {
    user.activeFieldId = nextFields[0]?.id || null
  } else if (user.activeFieldId && !nextFields.some((f) => f.id === user.activeFieldId)) {
    user.activeFieldId = nextFields[0]?.id || null
  }
  saveDb(db)
  return { deletedFieldId: fieldId, nextActiveFieldId: user.activeFieldId }
}

function loadResetRequests() {
  try {
    const raw = authLocalGet(AUTH_RESET_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveResetRequests(items) {
  authLocalSet(AUTH_RESET_KEY, JSON.stringify(items))
}

export function requestPasswordReset(email) {
  const normalizedEmail = normalizeEmail(email)
  const db = loadDb()
  const user = getUserByEmail(db, normalizedEmail)
  // Always return success-looking response to avoid account enumeration.
  if (!user) return { sent: true, link: '' }
  const token = makeId('rst')
  const expiresAt = Date.now() + 1000 * 60 * 30
  const items = loadResetRequests().filter((x) => x?.expiresAt > Date.now())
  items.push({ token, userId: user.id, expiresAt })
  saveResetRequests(items)
  const link = `${window.location.origin}${window.location.pathname}#reset=${encodeURIComponent(token)}`
  return { sent: true, link }
}

export async function resetPasswordWithToken(token, newPassword) {
  if (String(newPassword || '').length < 8) throw new Error('Password must be at least 8 characters.')
  const cleanToken = String(token || '').trim()
  if (!cleanToken) throw new Error('Invalid reset token.')
  const items = loadResetRequests()
  const match = items.find((x) => x?.token === cleanToken && x?.expiresAt > Date.now())
  if (!match) throw new Error('Reset link is invalid or expired.')
  const db = loadDb()
  const user = db.users.find((u) => u.id === match.userId)
  if (!user) throw new Error('Account not found.')
  user.password = await buildPasswordRecord(newPassword)
  user.trustedDeviceIds = []
  saveDb(db)
  saveResetRequests(items.filter((x) => x?.token !== cleanToken))
  return { ok: true }
}

export function markTourCompleted(userId) {
  const db = loadDb()
  const user = db.users.find((u) => u.id === userId)
  if (!user) return
  user.hasCompletedTour = true
  saveDb(db)
}
