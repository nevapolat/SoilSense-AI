const SHARED_KEYS = new Set([
  'soilsense.lang',
  'soilsense.auth.db.v1',
  'soilsense.auth.session.v1',
])

export function getStorageScopePrefix(userId, fieldId) {
  return `soilsense.u.${userId}.f.${fieldId}.`
}

export function toScopedStorageKey(userId, fieldId, key) {
  return `${getStorageScopePrefix(userId, fieldId)}${String(key)}`
}

function shouldScopeKey(key) {
  return typeof key === 'string' && key.startsWith('soilsense.') && !SHARED_KEYS.has(key)
}

export function installScopedLocalStorage(scopePrefix) {
  if (!window?.localStorage || !scopePrefix) return () => {}
  const storage = window.localStorage
  const originalGetItem = storage.getItem.bind(storage)
  const originalSetItem = storage.setItem.bind(storage)
  const originalRemoveItem = storage.removeItem.bind(storage)

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
