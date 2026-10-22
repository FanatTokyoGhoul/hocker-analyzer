import { Btn } from './Btn'

type Props = {
  /** Имя проекта (или видео) — null, пока ничего не открыто. */
  name: string | null
  title?: string
  dirty: boolean
  undoLabel: string | null
  redoLabel: string | null
  hasMoments: boolean
  onUndo(): void
  onRedo(): void
  onOpenVideo(): void
  onOpenProject(): void
  onStats(): void
  onExport(): void
  onSave(saveAs: boolean): void
  onSettings(): void
}

/** Шапка: файл, отмена/повтор, открытие, статистика, экспорт, сохранение, настройки. */
export function Toolbar(p: Props): React.JSX.Element {
  const open = p.name !== null
  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">🏒</span>
        <span>Hockey Analyzer</span>
      </div>
      <div className="toolbar-file">
        {open && (
          <>
            <span className="file-name" title={p.title}>
              {p.name}
            </span>
            {p.dirty && <span className="dirty" title="Есть несохранённые изменения" />}
            <Btn
              variant="ghost"
              className="icon-btn"
              disabled={!p.undoLabel}
              onClick={p.onUndo}
              title={`Отменить${p.undoLabel ? `: ${p.undoLabel}` : ''} (Ctrl+Z)`}
              aria-label="Отменить"
            >
              ↶
            </Btn>
            <Btn
              variant="ghost"
              className="icon-btn"
              disabled={!p.redoLabel}
              onClick={p.onRedo}
              title={`Повторить${p.redoLabel ? `: ${p.redoLabel}` : ''} (Ctrl+Shift+Z)`}
              aria-label="Повторить"
            >
              ↷
            </Btn>
          </>
        )}
      </div>
      <div className="toolbar-actions">
        <Btn variant="ghost" onClick={p.onOpenVideo} title="Открыть видео матча">
          Открыть видео
        </Btn>
        <Btn variant="ghost" onClick={p.onOpenProject} title="Открыть проект (Ctrl+O)">
          Открыть проект
        </Btn>
        <Btn variant="ghost" onClick={p.onStats} disabled={!open} title="Статистика по тегам и периодам, выгрузка в CSV">
          Статистика
        </Btn>
        <Btn variant="ghost" onClick={p.onExport} disabled={!open || !p.hasMoments} title="Сохранить моменты в mp4 с рисунками">
          Экспорт
        </Btn>
        <Btn variant="ghost" onClick={() => p.onSave(true)} disabled={!open} title="Сохранить как (Ctrl+Shift+S)">
          Сохранить как…
        </Btn>
        <Btn variant="primary" onClick={() => p.onSave(false)} disabled={!open} title="Сохранить (Ctrl+S)">
          Сохранить
        </Btn>
        <Btn variant="ghost" className="icon-btn" onClick={p.onSettings} title="Настройки" aria-label="Настройки">
          ⚙
        </Btn>
      </div>
    </header>
  )
}
