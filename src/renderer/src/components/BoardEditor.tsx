import { useEffect, useRef, useState } from 'react'
import type { Shape } from '../../../shared/types'
import { PRESET_COLORS } from '../../../shared/settings'
import { fitContain } from '../lib/geometry'
import { RINK_ASPECT } from '../lib/rink'
import { DrawingLayer, type Tool } from './DrawingLayer'
import { Swatch, TOOLS } from './DrawMenu'
import { Btn } from './Btn'
import { isTyping } from '../hooks/useHotkeys'

type Props = {
  shapes: Shape[]
  color: string
  recentColors: string[]
  onColor(c: string): void
  onChange(shapes: Shape[]): void
  /** Подсказка слева от кнопок. */
  note: string
  /** Кнопки справа, после «Убрать последнюю» и «Очистить». */
  actions?: React.ReactNode
}

// подсветка игрока на схеме не нужна — там нет «всего остального», что затемнять
const BOARD_TOOLS = TOOLS.filter((t) => t.id !== 'spotlight')

/** Схема площадки: те же инструменты, что на видео, поверх разметки площадки. Общая для схемы момента и свободных схем. */
export function BoardEditor({ shapes, color, recentColors, onColor, onChange, note, actions }: Props): React.JSX.Element {
  const [tool, setTool] = useState<Tool>('arrow')
  const box = useRef<HTMLDivElement>(null)
  const [space, setSpace] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = (): void => setSpace({ width: el.clientWidth - 40, height: window.innerHeight * 0.58 })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
  const size = fitContain(space, RINK_ASPECT)

  // те же буквы инструментов, что над видео (V, A, P…): клавиши плеера в открытом окне не работают
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat || isTyping(e.target)) return
      const t = BOARD_TOOLS.find((x) => x.code === e.code)
      if (t) {
        e.preventDefault()
        setTool(t.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <div className="board-toolbar">
        <div className="segmented" role="radiogroup" aria-label="Инструмент схемы">
          {BOARD_TOOLS.map((t) => (
            <Btn key={t.id} active={tool === t.id} role="radio" aria-checked={tool === t.id} title={`${t.label} — ${t.hint} (${t.key})`} onClick={() => setTool(t.id)}>
              <span className="tool-icon">{t.icon}</span>
              {t.label}
            </Btn>
          ))}
        </div>
        <div className="draw-colors">
          {PRESET_COLORS.map((c) => (
            <Swatch key={c} color={c} active={c === color} onPick={onColor} />
          ))}
          {recentColors.map((c) => (
            <Swatch key={`recent-${c}`} color={c} active={c === color} onPick={onColor} />
          ))}
          <input type="color" value={color} onChange={(e) => onColor(e.target.value)} aria-label="Любой цвет" />
        </div>
      </div>
      <div className="board-canvas" ref={box}>
        {size.width > 0 && (
          <div className="board-frame" style={{ width: size.width, height: size.height }}>
            <DrawingLayer
              width={size.width}
              height={size.height}
              shapes={shapes}
              editable
              tool={tool}
              color={color}
              background="rink"
              onAdd={(s) => onChange([...shapes, s])}
              onUpdate={(s) => onChange(shapes.map((x) => (x.id === s.id ? s : x)))}
              onDelete={(id) => onChange(shapes.filter((x) => x.id !== id))}
            />
          </div>
        )}
      </div>
      <div className="board-actions">
        <span className="muted small">{note}</span>
        <Btn disabled={!shapes.length} onClick={() => onChange(shapes.slice(0, -1))}>
          ↶ Убрать последнюю
        </Btn>
        <Btn disabled={!shapes.length} onClick={() => onChange([])}>
          Очистить
        </Btn>
        {actions}
      </div>
    </>
  )
}
