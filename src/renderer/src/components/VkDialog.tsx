import { useEffect, useRef, useState } from 'react'
import type { VideoInfo } from '../../../shared/types'
import { normalizeVkUrl, type DownloadProgress } from '../../../shared/vk'
import { errorText } from '../lib/errors'
import { formatTime } from '../lib/time'
import { Btn } from './Btn'
import { Modal } from './Modal'

type Props = {
  /** Спросить про несохранённое перед заменой проекта; false — пользователь передумал. */
  confirmDiscard(): Promise<boolean>
  onOpened(v: VideoInfo): void
  onClose(): void
}

const PHASES: Record<DownloadProgress['phase'], string> = {
  tool: 'Подготовка загрузчика (только в первый раз)…',
  info: 'Получаю сведения о видео…',
  video: 'Скачиваю видео',
  audio: 'Скачиваю звук',
  merge: 'Склеиваю видео и звук…'
}

const mb = (bytes: number): string => (bytes / 1024 / 1024).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0)

/** «124 из 702 МБ · 5,2 МБ/с · осталось 1:52» — что известно. */
export function progressDetails(p: DownloadProgress): string {
  const parts: string[] = []
  if (p.downloaded > 0) parts.push(p.total ? `${mb(p.downloaded)} из ${mb(p.total)} МБ` : `${mb(p.downloaded)} МБ`)
  if (p.speed) parts.push(`${mb(p.speed).replace('.', ',')} МБ/с`)
  if (p.eta !== null && p.eta > 0) parts.push(`осталось ${formatTime(p.eta, false)}`)
  return parts.join(' · ')
}

/** Четвёртый способ открыть видео: по ссылке на VK или VK Видео — скачивание с полосой прогресса. */
export function VkDialog({ confirmDiscard, onOpened, onClose }: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const url = normalizeVkUrl(text)
  // отмену пользователь нажал сам — это не ошибка
  const cancelled = useRef(false)

  // подписка на всё время окна: первые события приходят сразу после запуска
  useEffect(() => window.api.onVkProgress(setProgress), [])

  const start = async (): Promise<void> => {
    if (!url || busy) return
    setError(null)
    if (!(await confirmDiscard())) return
    setBusy(true)
    setProgress(null)
    cancelled.current = false
    try {
      const v = await window.api.downloadVk(url)
      onOpened(v)
      onClose()
    } catch (e) {
      if (!cancelled.current) setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const ratio = progress?.ratio ?? null
  const label = progress ? PHASES[progress.phase] : PHASES.info
  return (
    <Modal title="Видео из VK" onClose={onClose} locked={busy} className="vk-modal">
      <section className="settings-section">
        <label className="vk-field">
          <span>Ссылка на видео VK или VK Видео</span>
          <input
            autoFocus
            value={text}
            disabled={busy}
            spellCheck={false}
            placeholder="https://vkvideo.ru/video-123_456"
            aria-label="Ссылка на видео VK"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void start()
            }}
          />
        </label>
        {text.trim() && !url && <p className="warn-text small">Нужна ссылка на видео: vk.com/video…, vkvideo.ru/video… или ссылка из «Поделиться».</p>}
        <p className="muted small">
          Видео сохранится в папку «Видео/Hockey Analyzer» и сразу откроется. Нужен интернет; приватные видео и видео только для участников сообщества скачать
          нельзя.
        </p>
      </section>

      <section className="settings-section export-run">
        {busy ? (
          <>
            <div className="export-progress" role="status" aria-live="polite">
              {progress?.title && <strong className="vk-title">{progress.title}</strong>}
              <span>
                {label}
                {ratio !== null && progress?.phase !== 'merge' ? ` · ${Math.floor(ratio * 100)}%` : ''}
              </span>
              <div className={`progress${ratio === null ? ' is-indeterminate' : ''}`} aria-label="Ход скачивания">
                <div style={ratio === null ? undefined : { width: `${ratio * 100}%` }} />
              </div>
              {progress && progressDetails(progress) && <span className="muted small">{progressDetails(progress)}</span>}
            </div>
            <Btn
              onClick={() => {
                cancelled.current = true
                void window.api.cancelVkDownload()
              }}
            >
              Отмена
            </Btn>
          </>
        ) : (
          <>
            {error && (
              <div className="export-error" role="alert">
                {error}
              </div>
            )}
            <Btn variant="primary" disabled={!url} onClick={() => void start()}>
              Скачать и открыть
            </Btn>
          </>
        )}
      </section>
    </Modal>
  )
}
