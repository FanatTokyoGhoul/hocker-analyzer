import type { Drawing, Moment } from '../../../shared/types'
import { frameIndex } from './time'

/**
 * Локальные времена рисунков одного видео по возрастанию: время проекта − offset видео.
 * videoOf — к какому видео относится рисунок (без videoId — к первому).
 */
export function drawingTimes(moments: Moment[], videoId?: string, offset = 0, videoOf?: (d: Drawing) => string): number[] {
  return moments
    .flatMap((m) => (m.drawings ?? []).filter((d) => !videoId || !videoOf || videoOf(d) === videoId).map((d) => d.time - offset))
    .sort((a, b) => a - b)
}

/**
 * Первый рисунок, кадр которого воспроизведение «перешагнуло» между кадрами prevFrame и curFrame
 * (prevFrame < кадр рисунка ≤ curFrame). Проверка по пересечению, а не по равенству: на высокой
 * скорости или при пропуске кадров нужный кадр может так и не показаться.
 */
export function findCrossedDrawing(times: number[], prevFrame: number, curFrame: number, fps: number): number | null {
  if (curFrame <= prevFrame) return null
  for (const t of times) {
    const f = frameIndex(t, fps)
    if (f > curFrame) break
    if (f > prevFrame) return t
  }
  return null
}
