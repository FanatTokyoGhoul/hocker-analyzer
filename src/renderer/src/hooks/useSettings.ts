import { useCallback, useEffect, useRef, useState } from 'react'
import { sanitizeSettings, type Settings } from '../../../shared/settings'

/** Настройки из settings.json в профиле приложения (чтение и запись — в main-процессе). */
export function useSettings(): [Settings, (patch: Partial<Settings>) => void, string | null] {
  const [{ settings: initial, path }] = useState(() => {
    try {
      return window.api.loadSettings()
    } catch {
      // main недоступен (не должно случаться) — работаем с умолчаниями в памяти
      return { settings: sanitizeSettings(null), path: null }
    }
  })
  const [settings, setSettings] = useState(initial)

  // первую отрисовку не сохраняем — это то, что только что прочитали из файла
  const loaded = useRef(true)
  useEffect(() => {
    if (loaded.current) {
      loaded.current = false
      return
    }
    window.api.saveSettings(settings)
  }, [settings])

  const update = useCallback((patch: Partial<Settings>) => setSettings((s) => sanitizeSettings({ ...s, ...patch })), [])
  return [settings, update, path]
}
