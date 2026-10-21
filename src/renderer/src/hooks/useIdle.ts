import { useEffect, useState } from 'react'

/** true, если пока `enabled` мышь над элементом не двигалась `ms` миллисекунд. */
export function useIdle(element: HTMLElement | null, enabled: boolean, ms = 2500): boolean {
  const [idle, setIdle] = useState(false)

  useEffect(() => {
    if (!element || !enabled) {
      setIdle(false)
      return
    }
    let timer = window.setTimeout(() => setIdle(true), ms)
    const wake = (): void => {
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), ms)
    }
    element.addEventListener('pointermove', wake)
    element.addEventListener('pointerdown', wake)
    window.addEventListener('keydown', wake)
    return () => {
      window.clearTimeout(timer)
      element.removeEventListener('pointermove', wake)
      element.removeEventListener('pointerdown', wake)
      window.removeEventListener('keydown', wake)
    }
  }, [element, enabled, ms])

  return idle
}
