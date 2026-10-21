import type { ProjectVideo } from '../../../shared/types'

/** Покрывает ли видео время проекта t (длительность неизвестна — считаем, что покрывает всё после начала). */
export function videoCovers(v: ProjectVideo, t: number, tolerance = 0): boolean {
  return t >= v.offset - tolerance && (v.duration === undefined || t <= v.offset + v.duration + tolerance)
}

/**
 * На каком видео смотреть время проекта t: активное, если оно его покрывает (другой ракурс того же эпизода
 * не переключаем), иначе видео, начавшееся позже всех до t (следующий период), иначе первое покрывающее.
 */
export function locateTime(videos: ProjectVideo[], t: number, preferId?: string, tolerance = 0.05): ProjectVideo | null {
  const preferred = videos.find((v) => v.id === preferId)
  if (preferred && videoCovers(preferred, t, tolerance)) return preferred
  let best: ProjectVideo | null = null
  for (const v of videos) {
    if (videoCovers(v, t, tolerance) && (!best || v.offset > best.offset)) best = v
  }
  return best
}

/**
 * Видео для момента — по его середине: момент, начавшийся ровно на стыке периодов,
 * относится к следующему видео, а не к последнему кадру предыдущего.
 */
export function locateMoment(videos: ProjectVideo[], m: { start: number; end: number }, preferId?: string): ProjectVideo | null {
  return locateTime(videos, (m.start + m.end) / 2, preferId) ?? locateTime(videos, m.start, preferId)
}

/** Сдвиг для «продолжения» (следующего периода): сразу после конца самого позднего видео. */
export function continuationOffset(videos: ProjectVideo[]): number {
  return videos.reduce((max, v) => Math.max(max, v.offset + (v.duration ?? 0)), 0)
}

/**
 * Синхронизация ракурсов по событию: в видео ref событие на локальном времени refLocal,
 * в видео target — на targetLocal. Возвращает сдвиг target, при котором оба совпадут во времени проекта.
 * Отрицательный сдвиг — камеру включили раньше основной.
 */
export function syncOffset(ref: ProjectVideo, refLocal: number, targetLocal: number): number {
  return Math.round((ref.offset + refLocal - targetLocal) * 1000) / 1000
}

const nextNumber = (videos: ProjectVideo[], prefix: string): number =>
  videos.reduce((n, v) => {
    const m = new RegExp(`^${prefix} (\\d+)$`).exec(v.label)
    return m ? Math.max(n, Number(m[1]) + 1) : n
  }, 2)

/** Название нового периода: следующее после уже существующих «Период N» (первое видео — период 1). */
export const nextPeriodLabel = (videos: ProjectVideo[]): string => `Период ${nextNumber(videos, 'Период')}`
/** Название новой камеры: «Камера 2», «Камера 3», … */
export const angleLabel = (videos: ProjectVideo[]): string => `Камера ${nextNumber(videos, 'Камера')}`
