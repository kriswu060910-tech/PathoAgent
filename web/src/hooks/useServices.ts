import { useCallback, useEffect, useState } from 'react'

interface ServiceInfo {
  label: string
  running: boolean
  healthy: boolean
  crashed?: boolean
  exit_code?: number | null
  port: number
}

type Services = Record<string, ServiceInfo>

const API = import.meta.env.VITE_LAUNCHER_API_URL || '/api/launcher'

export function useServices() {
  const [services, setServices] = useState<Services>({})
  const [loading, setLoading] = useState('')

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API}/status`)
      if (res.ok) setServices(await res.json())
    } catch {
      // launcher 未启动时静默忽略
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const id = setInterval(fetchStatus, 5000)
    return () => clearInterval(id)
  }, [fetchStatus])

  const toggle = useCallback(async (name: string, running: boolean) => {
    setLoading(name)
    try {
      const action = running ? 'stop' : 'start'
      await fetch(`${API}/${action}/${name}`, { method: 'POST' })
      const maxWait = running ? 10 : 120
      for (let i = 0; i < maxWait; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        try {
          const res = await fetch(`${API}/status`)
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
      // ignore
    } finally {
      setLoading('')
    }
  }, [])

  const fetchLogs = useCallback(async (name: string): Promise<string> => {
    try {
      const res = await fetch(`${API}/logs/${name}?lines=80`)
      if (res.ok) {
        const data = await res.json()
        return data.logs || '暂无日志'
      }
    } catch { /* ignore */ }
    return '无法获取日志'
  }, [])

  return { services, loading, toggle, refresh: fetchStatus, fetchLogs }
}
