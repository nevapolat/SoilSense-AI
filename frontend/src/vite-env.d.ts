/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error'
  /** Dev only: forward logger output to the terminal running `vite` (see vite.config dev plugin). */
  readonly VITE_LOG_TO_TERMINAL?: string
  readonly VITE_LOG_PRECISE_LOCATION?: string
  readonly VITE_ENABLE_DIAGNOSTICS_UI?: string
  /** When true, persist Anthropic call counts + token totals (also on by default in dev). */
  readonly VITE_ANTHROPIC_USAGE_TELEMETRY?: string
  readonly VITE_ANTHROPIC_API_KEY?: string
  /** Optional: falls back to VITE_ANTHROPIC_API_KEY. */
  readonly VITE_ANTHROPIC_HAIKU_API_KEY?: string
  readonly VITE_CLAUDE_SOIL_ADVICE_MODEL?: string
  readonly VITE_CLAUDE_HAIKU_MODEL?: string
  /** When set with VITE_SUPABASE_ANON_KEY, accounts sync across devices (Supabase Auth + user_profiles). */
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** Optional: exact password-reset return URL; must be listed in Supabase → Auth → Redirect URLs. */
  readonly VITE_SUPABASE_AUTH_REDIRECT_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
