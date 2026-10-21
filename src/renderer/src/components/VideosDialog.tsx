import { useState } from 'react'
import type { ProjectVideo } from '../../../shared/types'
import { formatTime } from '../lib/time'
import { Btn } from './Btn'
import { CommitField, nonEmpty, parseNumber } from './CommitField'
import { Modal } from './Modal'

type Props = {
  videos: ProjectVideo[]
  activeId: string
  /** Где сейчас стоит каждое видео (локальное время), — для синхронизации по событию. */
  positions: ReadonlyMap<string, number>
  onUpdate(id: string, patch: Partial<Pick<ProjectVideo, 'label' | 'offset'>>): void
  onSync(targetId: string, refId: string): void
  onRemove(id: string): void
  onClose(): void
}

/** Видео проекта: названия, сдвиг во времени проекта, синхронизация ракурсов. */
export function VideosDialog({ videos, activeId, positions, onUpdate, onSync, onRemove, onClose }: Props): React.JSX.Element {
  const [ref, setRef] = useState(videos[0].id)
  const reference = videos.find((v) => v.id === ref) ?? videos[0]
  return (
    <Modal title="Видео проекта" onClose={onClose} className="videos-modal">
      <section className="settings-section">
        <p className="muted small">
          Время моментов общее для проекта. Сдвиг — с какой секунды проекта начинается видео: у следующего периода это конец предыдущего,
          у другой камеры — подбирается синхронизацией.
        </p>
        <div className="videos-list">
          {videos.map((v, i) => (
            <div className={`videos-row${v.id === activeId ? ' is-active' : ''}`} key={v.id}>
              <CommitField label={`Название видео ${i + 1}`} value={v.label} parse={nonEmpty} onCommit={(label) => onUpdate(v.id, { label })} />
              <span className="setting-input">
                <CommitField
                  label={`Сдвиг видео ${i + 1}, с`}
                  value={v.offset}
                  parse={parseNumber}
                  onCommit={(offset) => onUpdate(v.id, { offset })}
                />
                с
              </span>
              <span className="muted small mono">
                {formatTime(Math.max(0, v.offset), false)}
                {v.duration ? `–${formatTime(v.offset + v.duration, false)}` : ''}
              </span>
              <Btn variant="ghost" className="icon-btn" disabled={videos.length < 2} aria-label={`Удалить видео ${v.label}`} title="Убрать видео из проекта (рисунки на нём удалятся)" onClick={() => onRemove(v.id)}>
                ✕
              </Btn>
            </div>
          ))}
        </div>
      </section>
      <section className="settings-section">
        <h3>Синхронизация ракурсов</h3>
        <ol className="muted small sync-steps">
          <li>
            Остановите опорное видео на заметном событии (вбрасывание, свисток) —{' '}
            <select value={reference.id} onChange={(e) => setRef(e.target.value)} aria-label="Опорное видео">
              {videos.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
            , сейчас {formatTime(positions.get(reference.id) ?? 0)}.
          </li>
          <li>Переключитесь на другое видео и остановите его на том же событии.</li>
          <li>Нажмите «Синхронизировать» у этого видео.</li>
        </ol>
        <div className="videos-list">
          {videos
            .filter((v) => v.id !== reference.id)
            .map((v) => (
              <div className="videos-row" key={v.id}>
                <span>{v.label}</span>
                <span className="muted small mono">сейчас {formatTime(positions.get(v.id) ?? 0)}</span>
                <Btn onClick={() => onSync(v.id, reference.id)}>Синхронизировать</Btn>
              </div>
            ))}
        </div>
      </section>
    </Modal>
  )
}
