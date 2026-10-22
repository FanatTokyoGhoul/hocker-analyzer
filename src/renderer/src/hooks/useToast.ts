import { useCallback, useEffect, useState } from 'react'

const TOAST_MS = 6000

/** Короткое уведомление внизу экрана: notify(текст), скрывается само. */
export function useToast(): { toast: string | null; notify(msg: string): void; dismiss(): void } {
  const [toast, setToast] = useState<string | null>(null)
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), TOAST_MS)
    return () => window.clearTimeout(t)
  }, [toast])
  const notify = useCallback((msg: string) => setToast(msg), [])
  const dismiss = useCallback(() => setToast(null), [])
  return { toast, notify, dismiss }
}
