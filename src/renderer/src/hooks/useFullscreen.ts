import { useCallback, useEffect, useState } from 'react'

/** Полноэкранный режим для одного элемента (Fullscreen API Chromium). */
export function useFullscreen(element: HTMLElement | null, sync?: { key: unknown }): [boolean, () => void] {
  const [active, setActive] = useState(false)

  useEffect(() => {
    const onChange = (): void => setActive(!!element && document.fullscreenElement === element)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [element])

  // Android WebView не рассылает fullscreenchange: событие дождаться не всегда можно,
  // поэтому сверяем состояние хотя бы по этому сигналу (синхронно с полным экраном)
  useEffect(() => {
    setActive(!!element && document.fullscreenElement === element)
  }, [element, sync?.key])

  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void element?.requestFullscreen()
  }, [element])

  return [active, toggle]
}
