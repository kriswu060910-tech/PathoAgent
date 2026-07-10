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
}

const STORAGE_KEY = 'cookie-agent-settings'

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  baseURL: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  visionBaseUrl: '',
  visionApiKey: '',
  visionModel: 'gpt-4o',
  searchProvider: 'duckduckgo',
  searchApiKey: '',
  pathoApiUrl: 'http://localhost:8001',
  cellposeApiUrl: 'http://localhost:8002',
  launcherApiUrl: 'http://localhost:8099',
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS }
}

let currentSettings = loadSettings()
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((fn) => fn())
}

function saveSettings(s: AppSettings) {
  currentSettings = s
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  notify()
}

/** 在 React 外部读取当前设置（工具/服务层使用） */
export function getSettings(): AppSettings {
  return currentSettings
}

/** 合并更新部分设置 */
export function updateSettings(patch: Partial<AppSettings>) {
  saveSettings({ ...currentSettings, ...patch })
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
