import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react'

type Props<T> = {
  value: T
  label: string
  onCommit(value: T): void
  /** Текст → значение; null — ввод неверный, поле вернётся к текущему значению. */
  parse(text: string): T | null
  format?(value: T): string
  multiline?: boolean
  rows?: number
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'onKeyDown' | 'defaultValue'>

/**
 * Поле, применяющее значение по Enter или потере фокуса, а не на каждый символ.
 * Esc отменяет правку и не закрывает окно, в котором стоит поле. Если значение после
 * применения не изменилось (например, его ограничили), поле показывает то, что сохранено.
 */
export function CommitField<T>({ value, label, onCommit, parse, format = String, multiline, rows, className, ...rest }: Props<T>): React.JSX.Element {
  const shown = format(value)
  const [text, setText] = useState(shown)
  // после применения пересинхронизируемся, даже если значение осталось прежним
  const [revision, setRevision] = useState(0)
  useEffect(() => setText(shown), [shown, revision])
  const cancelled = useRef(false)

  const commit = (): void => {
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    const parsed = text === shown ? null : parse(text)
    if (parsed !== null && format(parsed) !== shown) onCommit(parsed)
    setRevision((r) => r + 1)
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    if (e.key === 'Escape') {
      // правку отменяем сами; дальше событие не пускаем — иначе закроется окно
      e.stopPropagation()
      e.preventDefault()
      cancelled.current = true
      setText(shown)
      e.currentTarget.blur()
    } else if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      e.currentTarget.blur()
    }
  }
  const common = {
    value: text,
    'aria-label': label,
    className,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText(e.target.value),
    onBlur: commit,
    onKeyDown
  }
  return multiline ? (
    <textarea {...common} rows={rows} placeholder={rest.placeholder} disabled={rest.disabled} />
  ) : (
    <input {...rest} {...common} />
  )
}

/** Разбор строки: непустая после trim. */
export const nonEmpty = (t: string): string | null => t.trim() || null
/** Разбор числа с запятой или точкой. */
export const parseNumber = (t: string): number | null => {
  const n = Number(t.trim().replace(',', '.'))
  return t.trim() && Number.isFinite(n) ? n : null
}
