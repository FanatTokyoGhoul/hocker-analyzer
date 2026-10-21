import { useState } from 'react'
import type { ProjectVideo } from '../../../shared/types'
import { Btn } from './Btn'

type Props = {
  videos: ProjectVideo[]
  activeId: string
  missing: ReadonlySet<string>
  disabled: boolean
  onSelect(id: string): void
  onAdd(kind: 'next' | 'angle'): void
  onManage(): void
}

/** Вкладки видео проекта (периоды, камеры) над плеером. */
export function VideoBar({ videos, activeId, missing, disabled, onSelect, onAdd, onManage }: Props): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  // стрелки, Home и End переключают вкладки (шаблон WAI-ARIA tabs)
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const i = videos.findIndex((v) => v.id === activeId)
    const next = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: videos.length - 1 }[e.key]
    if (next === undefined || disabled) return
    e.preventDefault()
    e.stopPropagation()
    const target = videos[(next + videos.length) % videos.length]
    onSelect(target.id)
    e.currentTarget.querySelector<HTMLElement>(`[data-video="${target.id}"]`)?.focus()
  }
  return (
    <div className="video-bar">
      <div className="video-tabs" role="tablist" aria-label="Видео проекта" onKeyDown={onKeyDown}>
        {videos.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            data-video={v.id}
            aria-selected={v.id === activeId}
            tabIndex={v.id === activeId ? 0 : -1}
            className={`video-tab${v.id === activeId ? ' is-active' : ''}${missing.has(v.id) ? ' is-missing' : ''}`}
            title={missing.has(v.id) ? `Файл не найден: ${v.path}` : v.path}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(v.id)}
          >
            {missing.has(v.id) && '⚠ '}
            {v.label}
          </button>
        ))}
      </div>
      <span className="video-bar-actions">
        {adding ? (
          <>
            <Btn
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                setAdding(false)
                onAdd('next')
              }}
              title="Следующий период или тайм: время продолжается после конца предыдущего видео"
            >
              + Следующий период
            </Btn>
            <Btn
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                setAdding(false)
                onAdd('angle')
              }}
              title="Другая камера того же матча: синхронизируется по общему событию"
            >
              + Другой ракурс
            </Btn>
            <Btn variant="ghost" className="icon-btn" onClick={() => setAdding(false)} aria-label="Отмена">
              ✕
            </Btn>
          </>
        ) : (
          <Btn variant="ghost" disabled={disabled} onClick={() => setAdding(true)} title="Добавить видео в проект">
            + Видео
          </Btn>
        )}
        {videos.length > 1 && (
          <Btn
            variant="ghost"
            className="icon-btn"
            onClick={onManage}
            title="Названия, сдвиг и синхронизация видео"
            aria-label="Управление видео"
          >
            ⚙
          </Btn>
        )}
      </span>
    </div>
  )
}
