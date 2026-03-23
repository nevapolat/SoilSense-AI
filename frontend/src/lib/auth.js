const AUTH_DB_KEY = 'soilsense.auth.db.v1'
const AUTH_SESSION_KEY = 'soilsense.auth.session.v1'
const AUTH_RESET_KEY = 'soilsense.auth.reset.v1'
const DEVICE_ID_KEY = 'soilsense.auth.deviceId.v1'
const AUTH_REMEMBERED_EMAIL_KEY = 'soilsense.auth.rememberedEmail.v1'

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

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function makeId(prefix) {
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${Date.now().toString(36)}_${rand}`
}

function getDeviceId() {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY)
    if (existing) return existing
    const created = makeId('dev')
    localStorage.setItem(DEVICE_ID_KEY, created)
    return created
  } catch {
    return makeId('dev')
  }
}

function setRememberedEmail(email) {
  const normalized = normalizeEmail(email)
  if (!normalized) return
  localStorage.setItem(AUTH_REMEMBERED_EMAIL_KEY, normalized)
}

function clearRememberedEmail() {
  localStorage.removeItem(AUTH_REMEMBERED_EMAIL_KEY)
}

export function getRememberedEmail() {
  try {
    return normalizeEmail(localStorage.getItem(AUTH_REMEMBERED_EMAIL_KEY) || '')
  } catch {
    return ''
  }
}

function loadDb() {
  try {
    const raw = localStorage.getItem(AUTH_DB_KEY)
    if (!raw) return { users: [] }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { users: [] }
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
    }
  } catch {
    return { users: [] }
  }
}

function saveDb(db) {
  localStorage.setItem(AUTH_DB_KEY, JSON.stringify(db))
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
  if (rememberMe) setRememberedEmail(normalizedEmail)
  else clearRememberedEmail()
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
  if (needsPassword) {
    const ok = await verifyPassword(password, user.password)
    if (!ok) throw new Error('Invalid email or password.')
    if (rememberMe) {
      user.trustedDeviceIds = Array.isArray(user.trustedDeviceIds) ? user.trustedDeviceIds : []
      if (!user.trustedDeviceIds.includes(deviceId)) user.trustedDeviceIds.push(deviceId)
      saveDb(db)
    }
  }
  const session = {
    userId: user.id,
    rememberMe: Boolean(rememberMe),
    createdAt: new Date().toISOString(),
  }
  persistSession(session)
  if (rememberMe) setRememberedEmail(normalizedEmail)
  else clearRememberedEmail()
  return session
}

export function persistSession(session) {
  const serialized = JSON.stringify(session)
  localStorage.removeItem(AUTH_SESSION_KEY)
  sessionStorage.removeItem(AUTH_SESSION_KEY)
  if (session?.rememberMe) localStorage.setItem(AUTH_SESSION_KEY, serialized)
  else sessionStorage.setItem(AUTH_SESSION_KEY, serialized)
}

export function restoreSession() {
  try {
    const persistent = localStorage.getItem(AUTH_SESSION_KEY)
    if (persistent) return JSON.parse(persistent)
  } catch {
    // ignore
  }
  try {
    const temporary = sessionStorage.getItem(AUTH_SESSION_KEY)
    if (temporary) return JSON.parse(temporary)
  } catch {
    // ignore
  }
  return null
}

export function logoutSession() {
  localStorage.removeItem(AUTH_SESSION_KEY)
  sessionStorage.removeItem(AUTH_SESSION_KEY)
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

function loadResetRequests() {
  try {
    const raw = localStorage.getItem(AUTH_RESET_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveResetRequests(items) {
  localStorage.setItem(AUTH_RESET_KEY, JSON.stringify(items))
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
