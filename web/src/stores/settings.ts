/**
 * 应用设置存储。
 *
 * 该模块与 React 解耦，可在服务层、工具函数等非组件场景中直接读取/更新设置。
 * React 侧通过 hooks/useSettings.ts 订阅变更。
 */

export interface AppSettings {
  apiKey: string
  baseURL: string
  model: string
  visionBaseUrl: string
  visionApiKey: string
  visionModel: string
  searchProvider: string
  searchApiKey: string
  pathoApiUrl: string
  cellposeApiUrl: string
  launcherApiUrl: string
  authApiUrl: string
}

const STORAGE_KEY = 'cookie-agent-settings'

const isDev = import.meta.env.DEV === true

// 生产模式下后端服务需运行在本地，通过 Tauri 或反向代理访问
export const DEFAULT_SETTINGS: Readonly<AppSettings> = Object.freeze({
  apiKey: '',
  baseURL: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  visionBaseUrl: '/api/vision',
  visionApiKey: '',
  visionModel: 'gpt-4o',
  searchProvider: 'duckduckgo',
  searchApiKey: '',
  pathoApiUrl: isDev ? '/api/patho' : 'http://localhost:8001',
  cellposeApiUrl: isDev ? '/api/cellpose' : 'http://localhost:8002',
  launcherApiUrl: isDev ? '/api/launcher' : 'http://localhost:8099',
  authApiUrl: isDev ? '/api/auth' : 'http://localhost:8100',
})

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const merged = { ...DEFAULT_SETTINGS, ...parsed }
      let migrated = false

      // 迁移：旧的 DashScope 直连地址改为 Vite 代理路径
      if (merged.visionBaseUrl?.includes('dashscope.aliyuncs.com')) {
        merged.visionBaseUrl = '/api/vision'
        migrated = true
      }
      // 迁移：dev 模式下旧的 localhost 直连地址改为代理路径
      if (isDev) {
        if (merged.pathoApiUrl === 'http://localhost:8001') { merged.pathoApiUrl = '/api/patho'; migrated = true }
        if (merged.cellposeApiUrl === 'http://localhost:8002') { merged.cellposeApiUrl = '/api/cellpose'; migrated = true }
        if (merged.launcherApiUrl === 'http://localhost:8099') { merged.launcherApiUrl = '/api/launcher'; migrated = true }
        if (!merged.authApiUrl || merged.authApiUrl === 'http://localhost:8100') { merged.authApiUrl = '/api/auth'; migrated = true }
      } else {
        // 生产模式下代理路径还原为直连地址
        if (merged.pathoApiUrl === '/api/patho') { merged.pathoApiUrl = 'http://localhost:8001'; migrated = true }
        if (merged.cellposeApiUrl === '/api/cellpose') { merged.cellposeApiUrl = 'http://localhost:8002'; migrated = true }
        if (merged.launcherApiUrl === '/api/launcher') { merged.launcherApiUrl = 'http://localhost:8099'; migrated = true }
        if (merged.authApiUrl === '/api/auth') { merged.authApiUrl = 'http://localhost:8100'; migrated = true }
      }

      // 迁移后写回 localStorage，避免每次加载重复迁移
      if (migrated) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
      }
      return merged
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS }
}

let currentSettings = loadSettings()
const listeners = new Set<() => void>()
const changeListeners = new Set<(settings: AppSettings) => void>()

function notify() {
  listeners.forEach((fn) => fn())
  changeListeners.forEach((fn) => fn(currentSettings))
}

const persistCallbacks = new Set<(s: AppSettings) => void>()

export function onSettingsPersist(cb: (s: AppSettings) => void) {
  persistCallbacks.add(cb)
  return () => persistCallbacks.delete(cb)
}

function saveSettings(s: AppSettings) {
  currentSettings = s
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  persistCallbacks.forEach((cb) => cb(s))
  notify()
}

/** 注册设置变更回调（返回取消订阅函数） */
export function onSettingsChange(cb: (settings: AppSettings) => void) {
  changeListeners.add(cb)
  return () => changeListeners.delete(cb)
}

/** 在 React 外部读取当前设置（工具/服务层使用） */
export function getSettings(): AppSettings {
  return currentSettings
}

/** 合并更新部分设置 */
export function updateSettings(patch: Partial<AppSettings>) {
  saveSettings({ ...currentSettings, ...patch })
}

/** 仅在内存中更新设置（不触发持久化/远程同步回调），用于登录和会话恢复场景 */
export function updateSettingsInMemory(s: AppSettings) {
  currentSettings = s
  notify()
}

/** 重置为默认值 */
export function resetSettings() {
  saveSettings({ ...DEFAULT_SETTINGS })
}

/** 订阅设置变更（供 React hook 使用） */
export function subscribeSettings(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** 获取当前设置的快照（供 React hook 使用） */
export function getSettingsSnapshot() {
  return currentSettings
}
