import { Btn } from '../renderer/src/components/Btn'
import type { VideoClock } from '../renderer/src/hooks/useVideoClock'
import { SPEED_PRESETS, formatTime } from '../renderer/src/lib/time'

type Props = {
  clock: VideoClock
  stepMs: number
  onTogglePlay(): void
  onStepFrame(delta: number): void
  onStepMs(sign: 1 | -1): void
  onRate(rate: number): void
  /** Кнопка «развернуть/свернуть» как в YouTube; без неё — не показывается (iOS). */
  fullscreen?: boolean
  onToggleFullscreen?: () => void
}

/** Управление под палец: крупные кнопки кадра и паузы, скорость одним нажатием. */
export function MobileTransport(p: Props): React.JSX.Element {
  const { clock, stepMs } = p
  return (
    <div className="m-transport">
      <div className="m-transport-row">
        <Btn variant="ghost" onClick={() => p.onStepMs(-1)} aria-label={`Назад на ${stepMs} мс`}>
          −{stepMs >= 1000 ? `${stepMs / 1000} с` : `${stepMs} мс`}
        </Btn>
        <Btn variant="ghost" className="m-big" onClick={() => p.onStepFrame(-1)} aria-label="Кадр назад">
          ◀︎|
        </Btn>
        <Btn variant="primary" className="m-big m-play" onClick={p.onTogglePlay} aria-label={clock.paused ? 'Воспроизвести' : 'Пауза'}>
          <svg className="btn-play-icon" viewBox="0 0 16 16" aria-hidden="true">
            {clock.paused ? <path d="M5 2.8v10.4a.6.6 0 0 0 .9.5l8.2-5.2a.6.6 0 0 0 0-1L5.9 2.3a.6.6 0 0 0-.9.5Z" /> : <path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" />}
          </svg>
        </Btn>
        <Btn variant="ghost" className="m-big" onClick={() => p.onStepFrame(1)} aria-label="Кадр вперёд">
          |▶︎
        </Btn>
        <Btn variant="ghost" onClick={() => p.onStepMs(1)} aria-label={`Вперёд на ${stepMs} мс`}>
          +{stepMs >= 1000 ? `${stepMs / 1000} с` : `${stepMs} мс`}
        </Btn>
      </div>
      <div className="m-transport-row">
        <span className="mono m-time">
          {formatTime(clock.time)}
          <span className="muted"> / {formatTime(clock.duration, false)}</span>
        </span>
        <div className="m-tr-right">
          <div className="segmented">
            {SPEED_PRESETS.map((r) => (
              <Btn key={r} active={Math.abs(clock.rate - r) < 0.001} onClick={() => p.onRate(r)} aria-label={`Скорость ×${r}`}>
                ×{r}
              </Btn>
            ))}
          </div>
          {p.onToggleFullscreen && (
            <button
              type="button"
              className="m-fs-toggle"
              aria-label={p.fullscreen ? 'Свернуть' : 'Развернуть'}
              onClick={p.onToggleFullscreen}
            >
              {p.fullscreen ? '⤡' : '⛶'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
