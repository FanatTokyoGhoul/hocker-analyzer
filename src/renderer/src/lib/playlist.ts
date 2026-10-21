import type { Moment } from '../../../shared/types'

/**
 * Решение плейлиста на очередной показанный кадр. Чистая функция —
 * хук usePlaylist только исполняет её результат на <video>.
 * Остановки на рисунках обрабатывает отдельный механизм (useDrawingStops).
 */
export type PlaylistStep =
  | { kind: 'continue' }
  | { kind: 'next'; index: number; seek: number }
  | { kind: 'finish' }

export function decidePlaylistStep(items: Moment[], index: number, mediaTime: number, fps: number): PlaylistStep {
  const moment = items[index]
  if (!moment) return { kind: 'finish' }
  if (mediaTime >= moment.end - 0.5 / fps) {
    const next = index + 1
    return next < items.length ? { kind: 'next', index: next, seek: items[next].start } : { kind: 'finish' }
  }
  return { kind: 'continue' }
}
