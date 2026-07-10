/// <reference types="vite/client" />

interface Window {
  __TAURI__?: unknown
}

interface ImportMetaEnv {
  readonly VITE_API_KEY?: string
  readonly VITE_API_BASE_URL?: string
  readonly VITE_API_MODEL?: string
  readonly VITE_SEARCH_PROVIDER?: 'duckduckgo' | 'tavily' | 'serper' | 'mock'
  readonly VITE_SEARCH_API_KEY?: string
  readonly VITE_SEARCH_MAX_RESULTS?: string
  readonly VITE_CORS_PROXY?: string
  readonly VITE_VISION_BASE_URL?: string
  readonly VITE_VISION_API_KEY?: string
  readonly VITE_VISION_MODEL?: string
  readonly VITE_VISION_PROXY_TARGET?: string
  readonly VITE_PATHO_API_URL?: string
  readonly VITE_CELLPOSE_API_URL?: string
  readonly VITE_LAUNCHER_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
