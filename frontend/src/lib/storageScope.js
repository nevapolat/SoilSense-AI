const SHARED_KEYS = new Set([
  'soilsense.lang',
  'soilsense.auth.db.v1',
  'soilsense.auth.session.v1',
  'soilsense.auth.deviceId.v1',
  'soilsense.auth.rememberedEmail.v1',
  'soilsense.auth.rememberedPassword.v1',
  'soilsense.auth.reset.v1',
])

export function getStorageScopePrefix(userId, fieldId) {
  return `soilsense.u.${userId}.f.${fieldId}.`
}

export function toScopedStorageKey(userId, fieldId, key) {
  return `${getStorageScopePrefix(userId, fieldId)}${String(key)}`
}

export function installScopedLocalStorage(scopePrefix) {
  if (!window?.localStorage || !scopePrefix) return () => {}
  const storage = window.localStorage
  const originalGetItem = storage.getItem.bind(storage)
  const originalSetItem = storage.setItem.bind(storage)
  const originalRemoveItem = storage.removeItem.bind(storage)

  function shouldScopeKey(key) {
    if (typeof key !== 'string' || !key.startsWith('soilsense.') || SHARED_KEYS.has(key)) return false
    // Keys from toScopedStorageKey() already include the scope prefix — do not double-prefix.
    if (key.startsWith(scopePrefix)) return false
    return true
  }

  function wrapKey(key) {
    return shouldScopeKey(key) ? `${scopePrefix}${key}` : key
  }

  storage.getItem = (key) => originalGetItem(wrapKey(key))
  storage.setItem = (key, value) => originalSetItem(wrapKey(key), value)
  storage.removeItem = (key) => originalRemoveItem(wrapKey(key))

  return () => {
    storage.getItem = originalGetItem
    storage.setItem = originalSetItem
    storage.removeItem = originalRemoveItem
  }
}
