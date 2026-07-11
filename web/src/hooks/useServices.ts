import { useCallback, useEffect, useState } from 'react'
import { getSettings } from '../stores/settings'

interface ServiceInfo {
  label: string
  running: boolean
  healthy: boolean
  crashed?: boolean
  exit_code?: number | null
  port: number
}

type Services = Record<string, ServiceInfo>

export function getLauncherUrl(): string {
  return getSettings().launcherApiUrl || import.meta.env.VITE_LAUNCHER_API_URL || 'http://localhost:8099'
}

const DEFAULT_SERVICES: Services = {
  patho: { label: 'Qwen2.5-VL 病理分析', running: false, healthy: false, port: 8001 },
  cellpose: { label: 'Cellpose 细胞分割', running: false, healthy: false, port: 8002 },
}

export function useServices(enabled = true) {
  const [services, setServices] = useState<Services>(DEFAULT_SERVICES)
  const [loading, setLoading] = useState('')
  const [connected, setConnected] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${getLauncherUrl()}/status`, { signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        setServices(await res.json())
        setConnected(true)
      }
    } catch {
      setConnected(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    fetchStatus()
    let id: ReturnType<typeof setInterval>
    const startPolling = () => {
      clearInterval(id)
      id = setInterval(fetchStatus, 5000)
    }
    const stopPolling = () => { clearInterval(id) }
    const handler = () => {
      if (document.visibilityState === 'visible') startPolling()
      else stopPolling()
    }
    startPolling()
    document.addEventListener('visibilitychange', handler)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', handler) }
  }, [fetchStatus, enabled])

  const [error, setError] = useState('')

  const toggle = useCallback(async (name: string, running: boolean) => {
    setLoading(name)
    setError('')
    try {
      const action = running ? 'stop' : 'start'
      await fetch(`${getLauncherUrl()}/${action}/${name}`, { method: 'POST' })
      const maxWait = running ? 10 : 120
      for (let i = 0; i < maxWait; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        try {
          const res = await fetch(`${getLauncherUrl()}/status`)
          if (res.ok) {
            const data = await res.json()
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
      setError(`${running ? '停止' : '启动'}服务失败，请检查 Launcher 是否运行`)
    } finally {
      setLoading('')
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

  return { services, loading, connected, error, toggle, refresh: fetchStatus, fetchLogs }
}
