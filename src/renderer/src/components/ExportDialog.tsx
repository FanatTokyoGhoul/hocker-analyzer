import { useState } from 'react'
import type { ExportProgress, ExportRequest } from '../../../shared/types'
import type { ExportOptions, ExportScope } from '../lib/exportRequest'
import { fileName } from '../lib/paths'
import { Btn } from './Btn'
import { Modal } from './Modal'

type Props = {
  counts: Record<ExportScope, number>
  /** Название текущего момента (для «Текущий момент»), null — время вне моментов. */
  currentTitle: string | null
  tagFilter: string | null
  hasBoards: boolean
  defaultHold: number
  /** Идёт подготовка или кодирование. */
  busy: boolean
  progress: ExportProgress | null
  result: string[] | null
  error: string | null
  onExport(scope: ExportScope, options: ExportOptions): void
  onCancel(): void
  onReveal(path: string): void
  onClose(): void
}


/** Экспорт моментов в mp4: рисунки — стоп-кадрами, подписи и схема площадки по желанию. */
export function ExportDialog(p: Props): React.JSX.Element {
  const [scope, setScope] = useState<ExportScope>(p.currentTitle ? 'current' : p.tagFilter ? 'visible' : 'all')
  const [mode, setMode] = useState<ExportRequest['mode']>('single')
  const [hold, setHold] = useState(String(p.defaultHold))
  const [captions, setCaptions] = useState(true)
  const [boards, setBoards] = useState(true)
  const holdSeconds = Number(hold.replace(',', '.'))
  const holdValid = Number.isFinite(holdSeconds) && holdSeconds >= 0 && holdSeconds <= 60
  const count = p.counts[scope]

  const scopes: { id: ExportScope; label: string; hidden?: boolean }[] = [
    { id: 'current', label: p.currentTitle ? `Текущий момент «${p.currentTitle}»` : 'Текущий момент', hidden: !p.currentTitle },
    { id: 'visible', label: `С тегом #${p.tagFilter} (${p.counts.visible})`, hidden: !p.tagFilter },
    { id: 'all', label: `Все моменты (${p.counts.all})` }
  ]

  return (
    <Modal title="Экспорт клипов" onClose={p.onClose} locked={p.busy} className="export-modal">
      <section className="settings-section">
        <h3>Что</h3>
        <div className="segmented export-choices" role="radiogroup" aria-label="Что экспортировать">
          {scopes
            .filter((s) => !s.hidden)
            .map((s) => (
              <Btn key={s.id} role="radio" aria-checked={scope === s.id} active={scope === s.id} disabled={p.busy} onClick={() => setScope(s.id)}>
                {s.label}
              </Btn>
            ))}
        </div>
        {count > 1 && (
          <div className="setting">
            <span>Как</span>
            <div className="segmented" role="radiogroup" aria-label="Как сохранить">
              <Btn role="radio" aria-checked={mode === 'single'} active={mode === 'single'} disabled={p.busy} onClick={() => setMode('single')}>
                Одним файлом-подборкой
              </Btn>
              <Btn role="radio" aria-checked={mode === 'separate'} active={mode === 'separate'} disabled={p.busy} onClick={() => setMode('separate')}>
                Отдельными файлами в папку
              </Btn>
            </div>
          </div>
        )}
      </section>

      <section className="settings-section">
        <h3>Оформление</h3>
        <label className="setting">
          <span>
            Стоп-кадр с рисунком
            <span className="muted small block">Видео встаёт на кадре с рисунком на это время. 0 — рисунки не попадут в видео.</span>
          </span>
          <span className="setting-input">
            <input type="number" min={0} max={60} step={0.5} value={hold} disabled={p.busy} aria-label="Стоп-кадр, секунд" onChange={(e) => setHold(e.target.value)} />с
          </span>
        </label>
        <label className="setting checkbox">
          <input type="checkbox" checked={captions} disabled={p.busy} onChange={(e) => setCaptions(e.target.checked)} />
          <span>Подпись в начале клипа: название, теги, заметка</span>
        </label>
        {p.hasBoards && (
          <label className="setting checkbox">
            <input type="checkbox" checked={boards} disabled={p.busy} onChange={(e) => setBoards(e.target.checked)} />
            <span>Схема площадки перед клипом (если нарисована)</span>
          </label>
        )}
      </section>

      <section className="settings-section export-run">
        {p.busy ? (
          <>
            <div className="export-progress">
              <span>
                {p.progress ? `Клип ${p.progress.clip} из ${p.progress.clips} · ${Math.round(p.progress.ratio * 100)}%` : 'Подготовка рисунков…'}
              </span>
              <div className="progress">
                <div style={{ width: `${(p.progress?.ratio ?? 0) * 100}%` }} />
              </div>
            </div>
            <Btn onClick={p.onCancel}>Отмена</Btn>
          </>
        ) : (
          <>
            {p.result && (
              <div className="export-result" role="status">
                Готово: {p.result.length === 1 ? fileName(p.result[0]) : `${p.result.length} файлов`}
                <Btn onClick={() => p.onReveal(p.result![0])}>Показать в папке</Btn>
              </div>
            )}
            {p.error && (
              <div className="export-error" role="alert">
                {p.error}
              </div>
            )}
            <Btn
              variant="primary"
              disabled={!count || !holdValid}
              onClick={() => p.onExport(scope, { mode: count > 1 ? mode : 'single', holdSeconds, captions, boards: p.hasBoards && boards })}
            >
              Экспортировать {count > 1 ? `${count} клипов` : 'клип'}
            </Btn>
          </>
        )}
      </section>
    </Modal>
  )
}
