import { createClient } from '@supabase/supabase-js'

let supabaseSingleton = null

export function isRemoteAuthConfigured() {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  return Boolean(
    typeof url === 'string' &&
      url.trim().length > 0 &&
      typeof key === 'string' &&
      key.trim().length > 0
  )
}

export function getSupabaseClient() {
  if (!isRemoteAuthConfigured()) return null
  if (!supabaseSingleton) {
    supabaseSingleton = createClient(
      import.meta.env.VITE_SUPABASE_URL.trim(),
      import.meta.env.VITE_SUPABASE_ANON_KEY.trim(),
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      }
    )
  }
  return supabaseSingleton
}
