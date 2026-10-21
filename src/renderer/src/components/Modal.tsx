import { useEffect, useRef, type ReactNode } from 'react'
import { Btn } from './Btn'

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'

type Props = {
  title: string
  onClose(): void
  className?: string
  /** Кнопки в шапке рядом с ✕. */
  actions?: ReactNode
  /** Не закрывать по клику мимо окна и по Esc (например, пока идёт экспорт). */
  locked?: boolean
  children: ReactNode
}

/** Модальное окно: фокус внутри (Tab не уходит наружу), Esc и клик мимо закрывают, фокус возвращается назад. */
export function Modal({ title, onClose, className, actions, locked, children }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.focus()
    return () => previous?.focus?.()
  }, [])

  return (
    <div className="modal-backdrop" onPointerDown={(e) => !locked && e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`modal${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            const t = e.target as HTMLElement
            // Esc в поле ввода только уводит из него фокус, окно закрывает следующий Esc
            if (t !== ref.current && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) t.blur()
            else if (!locked) onClose()
          }
          if (e.key === 'Tab' && ref.current) {
            const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
            if (items.length === 0) return
            const first = items[0]
            const last = items[items.length - 1]
            if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
              e.preventDefault()
              last.focus()
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault()
              first.focus()
            }
          }
        }}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <span className="modal-actions">
            {actions}
            <Btn variant="ghost" onClick={onClose} disabled={locked} aria-label="Закрыть">
              ✕
            </Btn>
          </span>
        </header>
        {children}
      </div>
    </div>
  )
}
