import { memo, useState } from 'react'
import type { Moment } from '../../../shared/types'
import { formatTime, parseTime } from '../lib/time'
import { parseTags } from '../lib/projectState'
import type { PlaylistView } from '../hooks/usePlaylist'
import type { QuickTag } from '../../../shared/settings'
import { Btn } from './Btn'
import { CommitField, nonEmpty } from './CommitField'
import { QuickTagsBar } from './QuickTagsBar'

export type Draft = { start: number | null; end: number | null; title: string; tags: string }

type Props = {
  moments: Moment[]
  allTags: string[]
  tagFilter: string | null
  activeId: string | null
  draft: Draft
  playlist: PlaylistView | null
  holding: boolean
  disabled: boolean
  onDraftChange(patch: Partial<Draft>): void
  onMarkIn(): void
  onMarkOut(): void
  onAdd(): void
  onTagFilter(tag: string | null): void
  onPlayAll(): void
  onStopPlaylist(): void
  onSelect(m: Moment): void
  onPlayOne(m: Moment): void
  onUpdate(id: string, patch: MomentPatch): void
  onSetBoundToNow(id: string, bound: 'start' | 'end'): void
  onDelete(m: Moment): void
  onBoard(m: Moment): void
  quickTags: QuickTag[]
  onQuickTag(t: QuickTag): void
  onConfigureQuickTags(): void
}

export type MomentPatch = Partial<Pick<Moment, 'title' | 'start' | 'end' | 'tags' | 'notes'>>

type RowProps = {
  m: Moment
  index: number
  active: boolean
  playing: boolean
} & Pick<Props, 'onSelect' | 'onPlayOne' | 'onUpdate' | 'onSetBoundToNow' | 'onDelete' | 'onBoard'>

const MomentRow = memo(function MomentRow({ m, index, active, playing, onSelect, onPlayOne, onUpdate, onSetBoundToNow, onDelete, onBoard }: RowProps): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const drawings = (m.drawings ?? []).reduce((n, d) => n + d.shapes.length, 0)
  const stop = (e: React.SyntheticEvent): void => e.stopPropagation()
  // кнопки не забирают фокус, поэтому перед закрытием снимаем его с поля — иначе правка не применится
  const toggleEditing = (open: boolean): void => {
    if (!open && document.activeElement instanceof HTMLElement) document.activeElement.blur()
    setEditing(open)
  }

  return (
    <li
      className={`moment${active ? ' is-active' : ''}${playing ? ' is-playing' : ''}${editing ? ' is-editing' : ''}`}
      onClick={() => onSelect(m)}
      title="Перейти к началу момента"
    >
      <div className="moment-head">
        <button type="button" className="moment-open" onMouseDown={(e) => e.preventDefault()} aria-label={`Перейти к моменту «${m.title}»`}>
          <span className="moment-index mono">{index + 1}</span>
          <span className="moment-title">{m.title}</span>
        </button>
        <span className="moment-actions" onClick={stop}>
          <Btn variant="ghost" className="icon-btn" title="Проиграть этот момент" aria-label="Проиграть" onClick={() => onPlayOne(m)}>
            ▶
          </Btn>
          <Btn
            variant="ghost"
            className="icon-btn"
            active={!!m.board?.length}
            title={m.board?.length ? 'Схема площадки (нарисована)' : 'Нарисовать схему на площадке'}
            aria-label="Схема площадки"
            onClick={() => onBoard(m)}
          >
            ▦
          </Btn>
          <Btn variant="ghost" className="icon-btn" active={editing} title="Изменить" aria-label="Изменить" onClick={() => toggleEditing(!editing)}>
            ✎
          </Btn>
          <Btn variant="ghost" className="icon-btn" title="Удалить момент" aria-label="Удалить" onClick={() => onDelete(m)}>
            ✕
          </Btn>
        </span>
      </div>
      <div className="moment-meta">
        <span className="mono">
          {formatTime(m.start, false)}–{formatTime(m.end, false)}
        </span>
        <span className="muted mono">{(m.end - m.start).toFixed(1)} с</span>
        {drawings > 0 && (
          <span className="badge" title="Фигур на рисунках">
            ✎ {drawings}
          </span>
        )}
        {(m.tags ?? []).map((t) => (
          <span key={t} className="chip">
            #{t}
          </span>
        ))}
      </div>
      {m.notes && !editing && <p className="moment-notes">{m.notes}</p>}

      {editing && (
        <div className="moment-edit" onClick={stop}>
          <CommitField label="Название" value={m.title} parse={nonEmpty} onCommit={(title) => onUpdate(m.id, { title: title.trim() })} />
          <div className="moment-times">
            <Btn variant="ghost" title="Начало = текущее время" onClick={() => onSetBoundToNow(m.id, 'start')}>
              [
            </Btn>
            <CommitField
              label="Начало"
              className="mono time-input"
              value={m.start}
              format={formatTime}
              parse={parseTime}
              onCommit={(start) => onUpdate(m.id, { start })}
            />
            <span className="muted">–</span>
            <CommitField
              label="Конец"
              className="mono time-input"
              value={m.end}
              format={formatTime}
              parse={parseTime}
              onCommit={(end) => onUpdate(m.id, { end })}
            />
            <Btn variant="ghost" title="Конец = текущее время" onClick={() => onSetBoundToNow(m.id, 'end')}>
              ]
            </Btn>
          </div>
          <CommitField
            label="Теги"
            className="moment-tags"
            placeholder="теги через запятую"
            value={m.tags ?? []}
            format={(tags) => tags.join(', ')}
            parse={parseTags}
            onCommit={(tags) => onUpdate(m.id, { tags })}
          />
          <CommitField
            multiline
            rows={3}
            label="Заметка"
            className="moment-notes-input"
            placeholder="Заметка: что не так и как надо (Ctrl+Enter — применить)"
            value={m.notes ?? ''}
            parse={(notes) => notes}
            onCommit={(notes) => onUpdate(m.id, { notes })}
          />
          <Btn onClick={() => toggleEditing(false)}>Готово</Btn>
        </div>
      )}
    </li>
  )
})

export const MomentsPanel = memo(function MomentsPanel(p: Props): React.JSX.Element {
  const visible = p.tagFilter ? p.moments.filter((m) => m.tags?.includes(p.tagFilter!)) : p.moments
  const playingId = p.playlist ? p.playlist.ids[p.playlist.index] : null
  const canAdd = p.draft.start !== null && p.draft.end !== null && p.draft.start !== p.draft.end

  return (
    <aside className="panel">
      <QuickTagsBar tags={p.quickTags} disabled={p.disabled} onTag={p.onQuickTag} onConfigure={p.onConfigureQuickTags} />
      <section className="draft">
        <h3>Новый момент</h3>
        <div className="draft-marks">
          <Btn onClick={p.onMarkIn} disabled={p.disabled} title="Начало = текущее время (I)">
            <span className="mark-key">I</span> {p.draft.start === null ? '—' : formatTime(p.draft.start)}
          </Btn>
          <Btn onClick={p.onMarkOut} disabled={p.disabled} title="Конец = текущее время (O)">
            <span className="mark-key">O</span> {p.draft.end === null ? '—' : formatTime(p.draft.end)}
          </Btn>
        </div>
        <input
          placeholder="Название, например «хорошая перепасовка»"
          value={p.draft.title}
          disabled={p.disabled}
          onChange={(e) => p.onDraftChange({ title: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && canAdd && p.onAdd()}
        />
        <input
          placeholder="Теги через запятую"
          value={p.draft.tags}
          disabled={p.disabled}
          onChange={(e) => p.onDraftChange({ tags: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && canAdd && p.onAdd()}
        />
        <Btn variant="primary" disabled={!canAdd} onClick={p.onAdd} title="Добавить момент (Enter)">
          Добавить момент
        </Btn>
      </section>

      <section className="moments">
        <div className="moments-head">
          <h3>
            Моменты <span className="muted">{visible.length}</span>
          </h3>
          {p.playlist ? (
            <Btn variant="danger" onClick={p.onStopPlaylist}>
              ■ Стоп {p.playlist.index + 1}/{p.playlist.ids.length}
              {p.holding ? ' · рисунок' : ''}
            </Btn>
          ) : (
            <Btn variant="primary" disabled={visible.length === 0} onClick={p.onPlayAll} title="Проиграть все видимые моменты подряд">
              ▶ Проиграть все
            </Btn>
          )}
        </div>
        {p.allTags.length > 0 && (
          <div className="tags">
            <Btn active={p.tagFilter === null} onClick={() => p.onTagFilter(null)}>
              все
            </Btn>
            {p.allTags.map((t) => (
              <Btn key={t} active={p.tagFilter === t} onClick={() => p.onTagFilter(p.tagFilter === t ? null : t)}>
                #{t}
              </Btn>
            ))}
          </div>
        )}
        {visible.length === 0 ? (
          <p className="muted empty-list">
            {p.moments.length ? 'Нет моментов с этим тегом.' : 'Поставьте начало (I) и конец (O) и нажмите Enter.'}
          </p>
        ) : (
          <ul className="moment-list">
            {visible.map((m, i) => (
              <MomentRow
                key={m.id}
                m={m}
                index={i}
                active={m.id === p.activeId}
                playing={m.id === playingId}
                onSelect={p.onSelect}
                onPlayOne={p.onPlayOne}
                onUpdate={p.onUpdate}
                onSetBoundToNow={p.onSetBoundToNow}
                onDelete={p.onDelete}
                onBoard={p.onBoard}
              />
            ))}
          </ul>
        )}
      </section>
    </aside>
  )
})
