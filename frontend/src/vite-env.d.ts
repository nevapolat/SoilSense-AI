/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error'
  /** Dev only: forward logger output to the terminal running `vite` (see vite.config dev plugin). */
  readonly VITE_LOG_TO_TERMINAL?: string
  readonly VITE_LOG_PRECISE_LOCATION?: string
  readonly VITE_ENABLE_DIAGNOSTICS_UI?: string
  readonly VITE_GEMINI_API_KEY?: string
  readonly VITE_GEMINI_MODEL?: string
  /** `gemini` (default) or `claude` */
  readonly VITE_LLM_PROVIDER?: string
  readonly VITE_ANTHROPIC_API_KEY?: string
  readonly VITE_CLAUDE_MODEL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
