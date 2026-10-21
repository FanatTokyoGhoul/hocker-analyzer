import { describe, expect, it } from 'vitest'
import type { Moment } from '../../../shared/types'
import { drawingTimes, findCrossedDrawing } from './drawingStops'

const fps = 30
const at = (frame: number): number => (frame + 0.5) / fps

describe('остановки на рисунках', () => {
  const moments: Moment[] = [
    { id: 'b', title: 'b', start: 5, end: 9, drawings: [{ time: at(200), shapes: [] }] },
    { id: 'a', title: 'a', start: 0, end: 4, drawings: [{ time: at(90), shapes: [] }, { time: at(30), shapes: [] }] }
  ]
  const times = drawingTimes(moments)

  it('собирает времена всех рисунков по порядку', () => {
    expect(times).toEqual([at(30), at(90), at(200)])
  })

  it('для видео с другим сдвигом берёт только его рисунки, в его локальном времени', () => {
    const ms: Moment[] = [
      { id: 'm', title: 'm', start: 0, end: 30, drawings: [{ time: 12, shapes: [] }, { time: 25, shapes: [], videoId: 'p2' }, { time: 21, shapes: [], videoId: 'p2' }] }
    ]
    const videoOf = (d: { videoId?: string }): string => d.videoId ?? 'p1'
    expect(drawingTimes(ms, 'p2', 20, videoOf)).toEqual([1, 5])
    expect(drawingTimes(ms, 'p1', 0, videoOf)).toEqual([12])
  })

  it('срабатывает, когда кадр рисунка показан или перешагнут', () => {
    expect(findCrossedDrawing(times, 29, 30, fps)).toBe(at(30))
    expect(findCrossedDrawing(times, 85, 95, fps)).toBe(at(90)) // пропущенные кадры
  })

  it('не срабатывает, если стартовали с кадра рисунка, или назад, или рядом', () => {
    expect(findCrossedDrawing(times, 30, 31, fps)).toBeNull()
    expect(findCrossedDrawing(times, 100, 50, fps)).toBeNull()
    expect(findCrossedDrawing(times, 31, 89, fps)).toBeNull()
  })

  it('из нескольких перешагнутых берёт первый', () => {
    expect(findCrossedDrawing(times, 0, 300, fps)).toBe(at(30))
  })
})
