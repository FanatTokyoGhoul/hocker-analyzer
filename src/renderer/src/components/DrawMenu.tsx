import { PRESET_COLORS, normalizeHex } from '../../../shared/settings'
import type { Tool } from './DrawingLayer'
import { Btn } from './Btn'
import { CommitField } from './CommitField'

export const TOOLS: { id: Exclude<Tool, 'none'>; icon: string; label: string; key: string; code: string; hint: string }[] = [
  { id: 'arrow', icon: '➚', label: 'Движение', key: 'A', code: 'KeyA', hint: 'сплошная стрелка' },
  { id: 'pass', icon: '⇢', label: 'Пас', key: 'P', code: 'KeyP', hint: 'пунктирная стрелка' },
  { id: 'line', icon: '╱', label: 'Линия', key: 'L', code: 'KeyL', hint: 'прямая' },
  { id: 'circle', icon: '◯', label: 'Круг', key: 'C', code: 'KeyC', hint: 'обвести' },
  { id: 'spotlight', icon: '◉', label: 'Подсветка', key: 'S', code: 'KeyS', hint: 'затемнить всё вокруг игрока' },
  { id: 'zone', icon: '⬠', label: 'Зона', key: 'Z', code: 'KeyZ', hint: 'многоугольник кликами' },
  { id: 'text', icon: 'T', label: 'Текст', key: 'T', code: 'KeyT', hint: 'подпись, клик по кадру' },
  { id: 'freehand', icon: '✎', label: 'От руки', key: 'D', code: 'KeyD', hint: 'свободная линия' }
]

type Props = {
  open: boolean
  tool: Tool
  color: string
  recentColors: string[]
  shapeCount: number
  canEdit: boolean
  onOpenChange(open: boolean): void
  onTool(t: Tool): void
  onColor(c: string): void
  onUndo(): void
  onClear(): void
}

/** Образец цвета; не забирает фокус. */
export function Swatch({ color, active, onPick }: { color: string; active: boolean; onPick(c: string): void }): React.JSX.Element {
  return (
    <button
      type="button"
      className={`swatch${active ? ' is-active' : ''}`}
      style={{ background: color }}
      title={color}
      aria-label={`Цвет ${color}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPick(color)}
    />
  )
}

/** Плавающее меню рисования поверх видео: полупрозрачная кнопка, по клику — панель инструментов и цветов. */
export function DrawMenu(p: Props): React.JSX.Element {
  const drawing = p.tool !== 'none'
  return (
    <div className="draw-menu" onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={`fab${p.open ? ' is-open' : ''}${drawing ? ' is-drawing' : ''}`}
        title="Рисование"
        aria-label="Меню рисования"
        aria-expanded={p.open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => p.onOpenChange(!p.open)}
      >
        <span className="fab-icon">✎</span>
        {drawing && <span className="fab-dot" style={{ background: p.color }} />}
      </button>

      {p.open && (
        <div className="draw-panel" role="dialog" aria-label="Рисование">
          <div className="draw-tools">
            {TOOLS.map((t) => (
              <Btn
                key={t.id}
                active={p.tool === t.id}
                onClick={() => p.onTool(p.tool === t.id ? 'none' : t.id)}
                title={`${t.label} — ${t.hint} (${t.key})`}
              >
                <span className="tool-icon">{t.icon}</span>
                {t.label}
              </Btn>
            ))}
          </div>

          <div className="draw-colors">
            {PRESET_COLORS.map((c) => (
              <Swatch key={c} color={c} active={c === p.color} onPick={p.onColor} />
            ))}
          </div>
          {p.recentColors.length > 0 && (
            <div className="draw-colors">
              <span className="muted small">Недавние</span>
              {p.recentColors.map((c) => (
                <Swatch key={c} color={c} active={c === p.color} onPick={p.onColor} />
              ))}
            </div>
          )}
          <div className="draw-custom">
            <label className="picker" title="Любой цвет (RGB)">
              <input type="color" value={p.color} onChange={(e) => p.onColor(e.target.value)} aria-label="Любой цвет" />
              <span>Любой цвет</span>
            </label>
            <CommitField className="mono hex-input" label="HEX-код цвета" spellCheck={false} value={p.color} parse={normalizeHex} onCommit={p.onColor} />
          </div>

          <div className="draw-actions">
            <Btn onClick={p.onUndo} disabled={!p.canEdit || p.shapeCount === 0} title="Убрать последнюю фигуру на кадре">
              ↶ Отменить
            </Btn>
            <Btn onClick={p.onClear} disabled={!p.canEdit || p.shapeCount === 0} title="Удалить все фигуры на этом кадре">
              Очистить кадр
            </Btn>
          </div>
        </div>
      )}
    </div>
  )
}
