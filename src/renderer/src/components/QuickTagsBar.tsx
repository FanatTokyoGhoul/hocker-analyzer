import { memo } from 'react'
import type { QuickTag } from '../../../shared/settings'
import { Btn } from './Btn'

type Props = {
  tags: QuickTag[]
  disabled: boolean
  onTag(tag: QuickTag): void
  onConfigure(): void
}

/** Код-окно: одно нажатие — момент вокруг текущего времени с тегом. */
export const QuickTagsBar = memo(function QuickTagsBar({ tags, disabled, onTag, onConfigure }: Props): React.JSX.Element {
  return (
    <section className="quick">
      <div className="quick-head">
        <h3>Быстрая разметка</h3>
        <Btn variant="ghost" className="icon-btn" title="Настроить кнопки" aria-label="Настроить кнопки быстрой разметки" onClick={onConfigure}>
          ⚙
        </Btn>
      </div>
      {tags.length ? (
        <div className="quick-grid">
          {tags.map((t, i) => (
            <Btn
              key={t.id}
              className="quick-btn"
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onTag(t)}
              title={`Момент «${t.label}»: ${t.before} с до и ${t.after} с после текущего времени, тег #${t.tag} (Shift+${i + 1})`}
            >
              <span>{t.label}</span>
              <kbd>⇧{i + 1}</kbd>
            </Btn>
          ))}
        </div>
      ) : (
        <p className="muted small">Кнопок нет — добавьте их в настройках.</p>
      )}
    </section>
  )
})
