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
  if (!isTauri()) return { ok: false, message: '非桌面环境，无法启动 Launcher' }
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const msg = await invoke<string>('start_launcher')
    return { ok: true, message: msg }
  } catch (err) {
    return { ok: false, message: typeof err === 'string' ? err : String(err) }
  }
}

export async function getLauncherInfo(): Promise<{
  projectRoot: string
  pythonPath: string
  hasProject: boolean
} | null> {
  if (!isTauri()) return null
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<{ projectRoot: string; pythonPath: string; hasProject: boolean }>('get_launcher_info')
  } catch {
    return null
  }
}
