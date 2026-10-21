import { useRef } from 'react'
import type { Moment } from '../../../shared/types'
import { clamp, formatTime } from '../lib/time'

type Props = {
  duration: number
  time: number
  moments: Moment[]
  draft: { start: number | null; end: number | null }
  activeId: string | null
  onSeek(time: number): void
  onSelectMoment(m: Moment): void
}

const pct = (t: number, d: number): string => `${d > 0 ? clamp((t / d) * 100, 0, 100) : 0}%`

/**
 * Две дорожки: сверху моменты (клик — перейти к началу), снизу шкала для перемотки.
 * Раздельные дорожки, чтобы клик по моменту не путался с перемоткой.
 */
export function Timeline({ duration, time, moments, draft, activeId, onSeek, onSelectMoment }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  const seekAt = (clientX: number): void => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || duration <= 0) return
    onSeek(clamp((clientX - rect.left) / rect.width, 0, 1) * duration)
  }

  const { start: ds, end: de } = draft
  return (
    <div className="timeline">
      <div className="timeline-lane">
        {moments.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`timeline-moment${m.id === activeId ? ' is-active' : ''}`}
            style={{ left: pct(m.start, duration), width: `max(6px, ${pct(m.end - m.start, duration)})` }}
            title={`${m.title}: ${formatTime(m.start, false)}–${formatTime(m.end, false)}`}
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
