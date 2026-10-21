import { SPEED_PRESETS, MAX_RATE, MIN_RATE, formatTime, frameIndex } from '../lib/time'
import type { VideoClock } from '../hooks/useVideoClock'
import { Btn } from './Btn'

type Props = {
  clock: VideoClock
  fps: number
  stepMs: number
  fullscreen: boolean
  onTogglePlay(): void
  onStepFrame(delta: number): void
  onStepMs(sign: 1 | -1): void
  onRate(rate: number): void
  onToggleFullscreen(): void
}

export function Transport(p: Props): React.JSX.Element {
  const { clock, fps, stepMs } = p
  return (
    <div className="transport">
      <div className="transport-group">
        <Btn variant="ghost" onClick={() => p.onStepMs(-1)} title={`Назад на ${stepMs} мс (Shift+←)`}>
          −{stepMs} мс
        </Btn>
        <Btn variant="ghost" className="icon-btn" onClick={() => p.onStepFrame(-1)} title="Кадр назад (←)" aria-label="Кадр назад">
          ◀︎|
        </Btn>
        <Btn variant="primary" className="btn-play" onClick={p.onTogglePlay} title="Пауза / воспроизведение (Space)" aria-label={clock.paused ? 'Воспроизвести' : 'Пауза'}>
          {clock.paused ? '▶' : '❚❚'}
        </Btn>
        <Btn variant="ghost" className="icon-btn" onClick={() => p.onStepFrame(1)} title="Кадр вперёд (→)" aria-label="Кадр вперёд">
          |▶︎
        </Btn>
        <Btn variant="ghost" onClick={() => p.onStepMs(1)} title={`Вперёд на ${stepMs} мс (Shift+→)`}>
          +{stepMs} мс
        </Btn>
      </div>

      <div className="transport-time">
        <span className="mono time-now">{formatTime(clock.time)}</span>
        <span className="muted mono"> / {formatTime(clock.duration, false)}</span>
        <span className="muted mono small"> · кадр {frameIndex(clock.time, fps)} · {fps.toFixed(fps % 1 ? 2 : 0)} fps</span>
      </div>

      <div className="transport-group">
        <div className="segmented">
          {SPEED_PRESETS.map((r, i) => (
            <Btn key={r} active={Math.abs(clock.rate - r) < 0.001} onClick={() => p.onRate(r)} title={`Скорость ×${r} (${i + 1})`}>
              ×{r}
            </Btn>
          ))}
        </div>
        <input
          type="range"
          className="speed-slider"
          min={MIN_RATE}
          max={MAX_RATE}
          step={0.05}
          value={clock.rate}
          onChange={(e) => p.onRate(Number(e.target.value))}
          title="Замедление 0.1–1"
          aria-label="Скорость"
        />
        <span className="mono speed-value">×{clock.rate.toFixed(2)}</span>
        <Btn
          variant="ghost"
          className="icon-btn"
          onClick={p.onToggleFullscreen}
          title={p.fullscreen ? 'Выйти из полного экрана (F / Esc)' : 'Полный экран (F)'}
          aria-label="Полный экран"
        >
          {p.fullscreen ? '⤡' : '⛶'}
        </Btn>
      </div>
    </div>
  )
}
