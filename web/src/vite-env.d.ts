/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_KEY?: string
  readonly VITE_API_BASE_URL?: string
  readonly VITE_API_MODEL?: string
  readonly VITE_SEARCH_PROVIDER?: 'duckduckgo' | 'tavily' | 'serper' | 'mock'
  readonly VITE_SEARCH_API_KEY?: string
  readonly VITE_SEARCH_MAX_RESULTS?: string
  readonly VITE_CORS_PROXY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
