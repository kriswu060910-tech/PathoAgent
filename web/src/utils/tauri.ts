/**
 * Tauri 环境检测与命令桥接。
 *
 * 仅在 Tauri 桌面应用中可用（window.__TAURI__ 存在时）。
 * 浏览器环境下所有函数安全返回 false / 空值。
 */

export function isTauri(): boolean {
  return '__TAURI__' in window
}

export async function startLauncher(): Promise<{ ok: boolean; message: string }> {
  // Tauri 桌面环境：通过 Rust invoke 启动
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const msg = await invoke<string>('start_launcher')
      return { ok: true, message: msg }
    } catch (err) {
      return { ok: false, message: typeof err === 'string' ? err : String(err) }
    }
  }

  // 浏览器开发环境：通过 Vite 中间件启动
  try {
    const res = await fetch('/api/launch', { method: 'POST' })
    if (res.ok) {
      const data = await res.json()
      return { ok: true, message: data.message || 'Launcher 已启动' }
    }
    return { ok: false, message: `请求失败 (${res.status})` }
  } catch (err) {
    return { ok: false, message: `无法连接 Vite 开发服务器: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export interface LauncherInfo {
  projectRoot: string
  pythonPath: string
  hasProject: boolean
  hasPython: boolean
}

export async function getLauncherInfo(): Promise<LauncherInfo | null> {
  if (!isTauri()) return null
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<LauncherInfo>('get_launcher_info')
  } catch {
    return null
  }
}

export interface LauncherDiagnosis {
  projectRoot: { ok: boolean; path?: string; reason?: string; launcherMain?: string; launcherMainExists?: boolean }
  pythonPath: { ok: boolean; path?: string; reason?: string; exists?: boolean }
  launcherPort: number
  launcherRunning: boolean
  envVars: Record<string, string>
  wherePython: { success: boolean; paths?: string[]; error?: string }
  currentExe: string
  currentDir: string
}

export async function diagnoseLauncher(): Promise<LauncherDiagnosis | null> {
  if (!isTauri()) return null
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<LauncherDiagnosis>('diagnose_launcher')
  } catch {
    return null
  }
}

// --- 环境检测 ---

export type { PythonEnvInfo, SetupInfo } from '../hooks/useServices'
import type { SetupInfo } from '../hooks/useServices'
import { getSettings } from '../stores/settings'

export async function detectEnvironments(): Promise<SetupInfo | null> {
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      return await invoke<SetupInfo>('detect_environments')
    } catch { /* fallback to HTTP */ }
  }
  try {
    const baseUrl = getSettings().launcherApiUrl || 'http://localhost:8099'
    const res = await fetch(`${baseUrl}/setup/environments`, { signal: AbortSignal.timeout(30000) })
    if (res.ok) return await res.json()
  } catch { /* ignore */ }
  return null
}

export async function selectPythonEnv(pythonPath: string): Promise<{ ok: boolean; message: string }> {
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const msg = await invoke<string>('select_python_env', { pythonPath })
      return { ok: true, message: msg }
    } catch (err) {
      return { ok: false, message: String(err) }
    }
  }
  try {
    const baseUrl = getSettings().launcherApiUrl || 'http://localhost:8099'
    const res = await fetch(`${baseUrl}/setup/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pythonPath }),
    })
    const data = await res.json()
    return { ok: res.ok, message: data.message || data.detail || '' }
  } catch (err) {
    return { ok: false, message: String(err) }
  }
}
