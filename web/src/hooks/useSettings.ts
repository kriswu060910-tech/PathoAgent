import { useCallback, useSyncExternalStore } from 'react'

import {
  type AppSettings,
  DEFAULT_SETTINGS,
  getSettingsSnapshot,
  resetSettings,
  subscribeSettings,
  updateSettings,
} from '../stores/settings'

export type { AppSettings }
export { DEFAULT_SETTINGS, getSettingsSnapshot, resetSettings, updateSettings }

export function useSettings() {
  const settings = useSyncExternalStore(
    subscribeSettings,
    getSettingsSnapshot,
    getSettingsSnapshot,
  )

  const update = useCallback((patch: Partial<AppSettings>) => {
    updateSettings(patch)
  }, [])

  const reset = useCallback(() => {
    resetSettings()
  }, [])

  return { settings, update, reset }
}
