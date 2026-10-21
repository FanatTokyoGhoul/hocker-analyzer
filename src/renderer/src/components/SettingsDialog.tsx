import type { VideoInfo } from '../../../shared/types'
import { DEFAULT_QUICK_TAGS, MAX_QUICK_TAGS, type HoldMode, type HoldScope, type QuickTag, type Settings } from '../../../shared/settings'
import { newId } from '../lib/ids'
import { formatTime } from '../lib/time'
import { Btn } from './Btn'
import { CommitField, nonEmpty, parseNumber } from './CommitField'
import { Modal } from './Modal'

type Props = {
  settings: Settings
  settingsFile: string | null
  info: VideoInfo | null
  canOptimize: boolean
  onChange(patch: Partial<Settings>): void
  onOptimize(): void
  onClose(): void
}

const HOLD_MODES: { id: HoldMode; label: string }[] = [
  { id: 'off', label: 'Не останавливаться' },
  { id: 'key', label: 'До нажатия клавиши' },
  { id: 'timer', label: 'На N секунд' }
]

const HOLD_SCOPES: { id: HoldScope; label: string }[] = [
  { id: 'always', label: 'При любом просмотре' },
  { id: 'playlist', label: 'Только в «Проиграть все»' }
]

const KEYS: [string, string][] = [
  ['Space', 'Пауза / продолжить'],
  ['← / →', 'Кадр назад / вперёд'],
  ['Shift + ← / →', '± N мс'],
  ['1 – 4', 'Скорость ×0.25 / ×0.5 / ×0.75 / ×1'],
  ['I / O', 'Начало / конец момента'],
  ['Enter', 'Добавить момент'],
  ['Shift + 1 – 9', 'Кнопки быстрой разметки'],
  ['A  P  L  C', 'Движение, пас, линия, круг'],
  ['S  Z  T  D', 'Подсветка, зона, текст, от руки'],
  ['Esc', 'Выключить рисование / выйти из полного экрана'],
  ['Ctrl + Z / Ctrl + Shift + Z', 'Отменить / повторить'],
  ['Колесо мыши, 0', 'Увеличить кадр / сбросить увеличение'],
  ['F', 'Полный экран'],
  ['Ctrl + S / Ctrl + O', 'Сохранить / открыть проект']
]

function QuickTagsEditor({ tags, onChange }: { tags: QuickTag[]; onChange(tags: QuickTag[]): void }): React.JSX.Element {
  const patch = (i: number, p: Partial<QuickTag>): void => onChange(tags.map((t, j) => (j === i ? { ...t, ...p } : t)))
  return (
    <>
      {tags.length > 0 && (
        <div className="quick-edit">
          <span className="muted small">Клавиша</span>
          <span className="muted small">Подпись</span>
          <span className="muted small">Тег</span>
          <span className="muted small">До, с</span>
          <span className="muted small">После, с</span>
          <span />
          {tags.map((t, i) => (
            <div className="quick-edit-row" key={t.id}>
              <kbd>⇧{i + 1}</kbd>
              <CommitField parse={nonEmpty} label={`Подпись кнопки ${i + 1}`} value={t.label} onCommit={(label) => patch(i, { label })} />
              <CommitField parse={nonEmpty} label={`Тег кнопки ${i + 1}`} value={t.tag} onCommit={(tag) => patch(i, { tag })} />
              <CommitField
                type="number"
                parse={parseNumber}
                label={`Секунд до, кнопка ${i + 1}`}
                min={0}
                max={120}
                step={0.5}
                value={t.before}
                onCommit={(before) => patch(i, { before })}
              />
              <CommitField
                type="number"
                parse={parseNumber}
                label={`Секунд после, кнопка ${i + 1}`}
                min={0}
                max={120}
                step={0.5}
                value={t.after}
                onCommit={(after) => patch(i, { after })}
              />
              <Btn
                variant="ghost"
                className="icon-btn"
                aria-label={`Удалить кнопку ${t.label}`}
                onClick={() => onChange(tags.filter((_, j) => j !== i))}
              >
                ✕
              </Btn>
            </div>
          ))}
        </div>
      )}
      <div className="quick-edit-actions">
        <Btn
          disabled={tags.length >= MAX_QUICK_TAGS}
          onClick={() =>
            onChange([...tags, { id: newId('q'), label: `Кнопка ${tags.length + 1}`, tag: `метка${tags.length + 1}`, before: 5, after: 3 }])
          }
        >
          + Кнопка
        </Btn>
        <Btn variant="ghost" onClick={() => onChange(DEFAULT_QUICK_TAGS)}>
          Вернуть стандартные
        </Btn>
      </div>
    </>
  )
}

/** Настройки, которые обычно задаются один раз. Сохраняются автоматически. */
export function SettingsDialog({ settings, settingsFile, info, canOptimize, onChange, onOptimize, onClose }: Props): React.JSX.Element {
  return (
    <Modal title="Настройки" onClose={onClose}>
      <section className="settings-section">
        <h3>Воспроизведение</h3>
        <label className="setting">
          <span>Шаг N для Shift + ← / →</span>
          <span className="setting-input">
            <CommitField
              type="number"
              parse={parseNumber}
              label="Шаг N, мс"
              min={1}
              max={60000}
              value={settings.stepMs}
              onCommit={(v) => onChange({ stepMs: v })}
            />
            мс
          </span>
        </label>
      </section>

      <section className="settings-section">
        <h3>Кнопки быстрой разметки</h3>
        <p className="muted small">
          Нажатие кнопки (или Shift + цифра) сразу создаёт момент «за N секунд до — через M секунд после» текущего времени с нужным тегом.
        </p>
        <QuickTagsEditor tags={settings.quickTags} onChange={(quickTags) => onChange({ quickTags })} />
      </section>

      <section className="settings-section">
        <h3>Кадры с рисунками</h3>
        <div className="setting">
          <span>Остановка</span>
          <div className="segmented" role="radiogroup" aria-label="Остановка на рисунках">
            {HOLD_MODES.map((m) => (
              <Btn
                key={m.id}
                active={settings.holdMode === m.id}
                role="radio"
                aria-checked={settings.holdMode === m.id}
                onClick={() => onChange({ holdMode: m.id })}
              >
                {m.label}
              </Btn>
            ))}
          </div>
        </div>
        {settings.holdMode === 'timer' && (
          <label className="setting">
            <span>N секунд</span>
            <span className="setting-input">
              <CommitField
                type="number"
                parse={parseNumber}
                label="N секунд"
                min={0.5}
                max={60}
                step={0.5}
                value={settings.holdSeconds}
                onCommit={(v) => onChange({ holdSeconds: v })}
              />
              с
            </span>
          </label>
        )}
        {settings.holdMode !== 'off' && (
          <div className="setting">
            <span>Где</span>
            <div className="segmented" role="radiogroup" aria-label="Где останавливаться">
              {HOLD_SCOPES.map((s) => (
                <Btn
                  key={s.id}
                  active={settings.holdScope === s.id}
                  role="radio"
                  aria-checked={settings.holdScope === s.id}
                  onClick={() => onChange({ holdScope: s.id })}
                >
                  {s.label}
                </Btn>
              ))}
            </div>
          </div>
        )}
        <p className="muted small">
          {settings.holdMode === 'key' && 'Видео встанет на кадре с рисунком и продолжится по любой клавише или клику.'}
          {settings.holdMode === 'timer' &&
            `Видео встанет на кадре с рисунком и продолжится само через ${settings.holdSeconds} с (Space — сразу). Если начать рисовать, таймер остановится.`}
          {settings.holdMode === 'off' && 'Рисунки показываются только на паузе.'}
        </p>
      </section>

      <section className="settings-section">
        <h3>Видео</h3>
        {info ? (
          <>
            <p className="muted small">
              {info.width}×{info.height} · {info.videoCodec.toUpperCase()} · {info.fps.toFixed(info.fps % 1 ? 2 : 0)} fps
              {info.variableFrameRate ? ' (переменная)' : ''} · {formatTime(info.duration, false)}
            </p>
            <div className="setting">
              <span>
                Оптимизировать для перемотки
                <span className="muted small block">
                  Перекодировать в H.264 с ключевым кадром каждые 10 кадров и постоянным fps — точнее покадровый шаг.
                </span>
              </span>
              <Btn onClick={onOptimize} disabled={!canOptimize}>
                Перекодировать
              </Btn>
            </div>
          </>
        ) : (
          <p className="muted small">Видео не открыто.</p>
        )}
      </section>

      {settingsFile && (
        <section className="settings-section">
          <h3>Файл настроек</h3>
          <div className="setting">
            <span className="mono small settings-path" title={settingsFile}>
              {settingsFile}
            </span>
            <Btn onClick={() => void window.api.revealSettings()}>Показать в папке</Btn>
          </div>
          <p className="muted small">Сохраняется автоматически. Файл можно скопировать на другой компьютер в ту же папку.</p>
        </section>
      )}

      <section className="settings-section">
        <h3>Горячие клавиши</h3>
        <dl className="keymap">
          {KEYS.map(([k, v]) => (
            <div key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </Modal>
  )
}
