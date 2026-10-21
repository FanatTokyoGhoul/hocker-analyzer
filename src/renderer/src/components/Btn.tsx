import type { ButtonHTMLAttributes } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; variant?: 'primary' | 'danger' | 'ghost' }

/** Кнопка, не забирающая фокус по клику — иначе Space нажимал бы её вместо паузы. */
export function Btn({ active, variant, className = '', ...rest }: Props): React.JSX.Element {
  const cls = ['btn', variant && `btn-${variant}`, active && 'is-active', className].filter(Boolean).join(' ')
  return <button type="button" className={cls} onMouseDown={(e) => e.preventDefault()} {...rest} />
}
