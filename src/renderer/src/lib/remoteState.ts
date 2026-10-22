import type { Moment, ProjectVideo, Shape, VideoInfo } from '../../../shared/types'
import type { RemoteState } from '../../../shared/remote'
import type { QuickTag } from '../../../shared/settings'
import { PRESET_COLORS } from '../../../shared/settings'
import type { VideoClock } from '../hooks/useVideoClock'
import { frameIndex } from './time'

export type RemoteInput = {
  title: string
  info: VideoInfo | null
  clock: VideoClock
  fps: number
  videos: ProjectVideo[]
  activeId: string
  moments: Moment[]
  activeMomentId: string | null
  playlist: { ids: string[]; index: number } | null
  hold: boolean
  draft: { start: number | null; end: number | null }
  quickTags: QuickTag[]
  canDraw: boolean
  drawHint: string | null
  shapes: Shape[]
  color: string
  recentColors: string[]
  stepMs: number
  notice: string | null
}

/** Короткий отпечаток строки (путь к файлу на телефон не уходит). */
function fingerprint(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/**
 * Ключ показанного кадра: видео, файл (после «указать файл» или конвертации кадр другой) и номер.
 * Телефон отправляет его с фигурой — компьютер сверяет, что рисуют по тому же кадру.
 */
export const remoteFrameKey = (videoId: string, path: string | undefined, frame: number): string =>
  `${videoId}:${fingerprint(path ?? '')}:${frame}`

/** Снимок состояния для телефона: только то, что нужно пульту, без путей к файлам. */
export function buildRemoteState(i: RemoteInput): RemoteState {
  const ready = !!i.info
  const frame = frameIndex(i.clock.time, i.fps)
  return {
    ready,
    title: i.title,
    time: i.clock.time,
    duration: i.clock.duration || i.info?.duration || 0,
    paused: i.clock.paused,
    rate: i.clock.rate,
    fps: i.fps,
    frame,
    frameKey: remoteFrameKey(i.activeId, i.info?.path, frame),
    aspect: i.info && i.info.height ? i.info.width / i.info.height : 16 / 9,
    videoId: ready ? i.activeId : null,
    videos: i.videos.map((v) => ({ id: v.id, label: v.label })),
    moments: i.moments.map((m) => ({
      id: m.id,
      title: m.title,
      start: m.start,
      end: m.end,
      tags: m.tags ?? [],
      ...(m.notes ? { notes: m.notes } : {}),
      shapes: (m.drawings ?? []).reduce((n, d) => n + d.shapes.length, 0)
    })),
    activeMomentId: i.activeMomentId,
    playlist: i.playlist ? { index: i.playlist.index, total: i.playlist.ids.length } : null,
    hold: i.hold,
    draft: i.draft,
    quickTags: i.quickTags.map((q) => ({ label: q.label })),
    canDraw: i.canDraw,
    drawHint: i.drawHint,
    shapes: i.shapes,
    color: i.color,
    colors: [...new Set([...PRESET_COLORS, ...i.recentColors])],
    stepMs: i.stepMs,
    notice: i.notice
  }
}
