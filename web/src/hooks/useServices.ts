import { useCallback, useEffect, useRef, useState } from 'react'
import { getSettings } from '../stores/settings'
import { setServiceKey, getServiceKey } from '../agent/tools/shared'

interface ServiceInfo {
  label: string
  running: boolean
  healthy: boolean
  crashed?: boolean
  exit_code?: number | null
  port: number
}

type Services = Record<string, ServiceInfo>

export interface PythonEnvInfo {
  path: string
  version: string
  is_conda: boolean
  env_name: string
  packages: Record<string, boolean>
  missing: string[]
  has_cuda: boolean
  score: number
}

export interface SetupInfo {
  environments: PythonEnvInfo[]
  current_python: string
  all_deps: Record<string, string>
}

export function getLauncherUrl(): string {
  return getSettings().launcherApiUrl || import.meta.env.VITE_LAUNCHER_API_URL || 'http://localhost:8099'
}

const DEFAULT_SERVICES: Services = {
  patho: { label: 'Qwen2.5-VL 病理分析', running: false, healthy: false, port: 8001 },
  cellpose: { label: 'Cellpose 细胞分割', running: false, healthy: false, port: 8002 },
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export function useServices(enabled = true) {
  const [services, setServices] = useState<Services>(DEFAULT_SERVICES)
  const [loading, setLoading] = useState('')
  const [connected, setConnected] = useState(false)
  const [setupInfo, setSetupInfo] = useState<SetupInfo | null>(null)
  const toggleControllerRef = useRef<AbortController | null>(null)

  const fetchStatus = useCallback(async (controller?: AbortController) => {
    try {
      const res = await fetch(`${getLauncherUrl()}/status`, {
        signal: controller
          ? AbortSignal.any([controller.signal, AbortSignal.timeout(3000)])
          : AbortSignal.timeout(3000),
      })
      if (controller?.signal.aborted) return
      if (res.ok) {
        const data = await res.json()
        if (data.service_api_key) {
          setServiceKey(data.service_api_key)
          delete data.service_api_key
        }
        setServices(data)
        setConnected(true)
      }
    } catch {
      if (controller?.signal.aborted) return
      setConnected(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let intervalId = setInterval(() => fetchStatus(controller), 5000)
    const startPolling = () => {
      clearInterval(intervalId)
      intervalId = setInterval(() => fetchStatus(controller), 5000)
    }
    const stopPolling = () => { clearInterval(intervalId) }
    const handler = () => {
      if (document.visibilityState === 'visible') startPolling()
      else stopPolling()
    }
    fetchStatus(controller)
    startPolling()
    document.addEventListener('visibilitychange', handler)
    return () => {
      controller.abort()
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handler)
    }
  }, [fetchStatus, enabled])

  const [error, setError] = useState('')

  useEffect(() => {
    return () => {
      toggleControllerRef.current?.abort()
    }
  }, [])

  const toggle = useCallback(async (name: string, running: boolean) => {
    toggleControllerRef.current?.abort()
    const controller = new AbortController()
    toggleControllerRef.current = controller
    setLoading(name)
    setError('')
    try {
      const action = running ? 'stop' : 'start'
      await fetch(`${getLauncherUrl()}/${action}/${name}`, { method: 'POST', signal: controller.signal })
      const maxWait = running ? 10 : 120
      for (let i = 0; i < maxWait; i++) {
        try {
          await sleep(1000, controller.signal)
        } catch {
          break
        }
        try {
          const res = await fetch(`${getLauncherUrl()}/status`, { signal: controller.signal })
          if (controller.signal.aborted) break
          if (res.ok) {
            const data = await res.json()
            if (data.service_api_key) {
              setServiceKey(data.service_api_key)
              delete data.service_api_key
            }
            const s = data[name]
            if (running ? !s?.running : s?.healthy) {
              setServices(data)
              break
            }
            setServices(data)
          }
        } catch { /* ignore */ }
      }
    } catch {
      if (controller.signal.aborted) return
      setError(`${running ? '停止' : '启动'}服务失败，请检查 Launcher 是否运行`)
    } finally {
      setLoading('')
      if (toggleControllerRef.current === controller) {
        toggleControllerRef.current = null
      }
    }
  }, [])

  const fetchLogs = useCallback(async (name: string): Promise<string> => {
    try {
      const res = await fetch(`${getLauncherUrl()}/logs/${name}?lines=80`)
      if (res.ok) {
        const data = await res.json()
        return data.logs || '暂无日志'
      }
    } catch { /* ignore */ }
    return '无法获取日志'
  }, [])

  const fetchSetup = useCallback(async (): Promise<SetupInfo | null> => {
    try {
      const res = await fetch(`${getLauncherUrl()}/setup/environments`, { signal: AbortSignal.timeout(30000) })
      if (res.ok) {
        const data = await res.json()
        setSetupInfo(data)
        return data
      }
    } catch { /* ignore */ }
    return null
  }, [])

  const selectEnv = useCallback(async (pythonPath: string): Promise<{ ok: boolean; message: string }> => {
    try {
      const res = await fetch(`${getLauncherUrl()}/setup/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getServiceKey()}` },
        body: JSON.stringify({ pythonPath }),
      })
      const data = await res.json()
      return { ok: res.ok, message: data.message || data.detail || '操作完成' }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  }, [])

  const installDeps = useCallback(async (pythonPath: string, packages: string[]): Promise<{ ok: boolean; output: string }> => {
    try {
      const res = await fetch(`${getLauncherUrl()}/setup/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getServiceKey()}` },
        body: JSON.stringify({ pythonPath, packages }),
      })
      const data = await res.json() as { ok?: boolean; output?: string; detail?: string }
      return { ok: res.ok && data.ok !== false, output: data.output || data.detail || '' }
    } catch (err) {
      return { ok: false, output: err instanceof Error ? err.message : String(err) }
    }
  }, [])

  return { services, loading, connected, error, toggle, refresh: fetchStatus, fetchLogs, setupInfo, fetchSetup, selectEnv, installDeps }
}
