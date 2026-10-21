import { useEffect, useRef } from 'react'

export type HotkeyHandler = (e: KeyboardEvent) => boolean | void

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) &&
  !(target instanceof HTMLInputElement && ['checkbox', 'radio', 'range', 'button'].includes(target.type))

/**
 * Глобальные горячие клавиши. Сопоставление по e.code, чтобы I/O и прочие
 * буквы работали и в русской раскладке. Обработчик возвращает false, если клавишу не обработал.
 */
export function useHotkeys(handler: HotkeyHandler): void {
  const ref = useRef(handler)
  ref.current = handler

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e.target)) {
        if (e.code === 'Escape') (e.target as HTMLElement).blur()
        return
      }
      if (ref.current(e) !== false) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
