import { useRef, useState } from 'react'
import type { Moment } from '../../../shared/types'
import { momentAt } from '../lib/projectState'
import { clamp, formatTime } from '../lib/time'
import { useFramePreview } from '../hooks/useFramePreview'

type Props = {
  duration: number
  time: number
  moments: Moment[]
  draft: { start: number | null; end: number | null }
  activeId: string | null
  /** Файл активного видео — для превью кадра при наведении. */
  src: string | null
  onSeek(time: number): void
  onSelectMoment(m: Moment): void
}

const pct = (t: number, d: number): string => `${d > 0 ? clamp((t / d) * 100, 0, 100) : 0}%`

/** Ширина превью, px; подсказка не вылезает за края таймлайна. */
const PREVIEW_WIDTH = 176

/**
 * Две дорожки: сверху моменты (клик — перейти к началу), снизу шкала для перемотки.
 * Раздельные дорожки, чтобы клик по моменту не путался с перемоткой.
 * При наведении над курсором — время, кадр и название момента под ним.
 */
export function Timeline({ duration, time, moments, draft, activeId, src, onSeek, onSelectMoment }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ left: number; time: number } | null>(null)
  const preview = useFramePreview(src)

  const onHover = (e: React.PointerEvent<HTMLDivElement>): void => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || duration <= 0 || rect.width <= 0) return
    const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1)
    const t = ratio * duration
    const half = PREVIEW_WIDTH / 2 + 4
    setHover({ left: clamp(ratio * rect.width, half, Math.max(half, rect.width - half)), time: t })
    preview.show(t)
  }
  const hovered = hover ? momentAt(moments, hover.time) : null

  const seekAt = (clientX: number): void => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || duration <= 0) return
    onSeek(clamp((clientX - rect.left) / rect.width, 0, 1) * duration)
  }

  const { start: ds, end: de } = draft
  return (
    <div className="timeline" onPointerMove={onHover} onPointerLeave={() => setHover(null)}>
      {hover && (
        <div className="timeline-preview" style={{ left: hover.left, width: PREVIEW_WIDTH }} aria-hidden="true">
          {src && !preview.failed && <canvas ref={preview.canvasRef} width={PREVIEW_WIDTH} height={Math.round((PREVIEW_WIDTH * 9) / 16)} />}
          <div className="timeline-preview-time mono">{formatTime(hover.time)}</div>
          {hovered && <div className="timeline-preview-title">{hovered.title}</div>}
        </div>
      )}
      <div className="timeline-lane">
        {moments.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`timeline-moment${m.id === activeId ? ' is-active' : ''}`}
            style={{ left: pct(m.start, duration), width: `max(6px, ${pct(m.end - m.start, duration)})` }}
            aria-label={`${m.title}: ${formatTime(m.start, false)}–${formatTime(m.end, false)}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelectMoment(m)}
          />
        ))}
        {moments.flatMap((m) =>
          (m.drawings ?? []).map((d) => <span key={`${m.id}-${d.time}`} className="timeline-drawing" style={{ left: pct(d.time, duration) }} />)
        )}
      </div>
      <div
        ref={ref}
        className="timeline-scrub"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          seekAt(e.clientX)
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) seekAt(e.clientX)
        }}
      >
        <div className="timeline-track">
          <div className="timeline-played" style={{ width: pct(time, duration) }} />
        </div>
        {ds !== null && de !== null && (
          <div className="timeline-draft" style={{ left: pct(Math.min(ds, de), duration), width: pct(Math.abs(de - ds), duration) }} />
        )}
        {ds !== null && <div className="timeline-mark" style={{ left: pct(ds, duration) }} />}
        {de !== null && <div className="timeline-mark" style={{ left: pct(de, duration) }} />}
        <div className="timeline-playhead" style={{ left: pct(time, duration) }} />
      </div>
    </div>
  )
}
