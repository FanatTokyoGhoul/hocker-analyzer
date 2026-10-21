import type { ExportClip, ExportRequest, Moment, Project, ProjectVideo } from '../../../shared/types'
import { drawingVideoId } from './projectState'
import { renderBoardPng, renderCaptionPng, renderShapesPng } from './shapeRender'
import { locateMoment } from './videos'

export type ExportScope = 'current' | 'visible' | 'all'

export type ExportOptions = {
  mode: ExportRequest['mode']
  holdSeconds: number
  captions: boolean
  boards: boolean
}

export type VideoMeta = { width: number; height: number; fps: number }

/** Подзаголовок подписи: теги и первая строка заметки. */
export function captionSubtitle(m: Moment): string {
  const tags = (m.tags ?? []).map((t) => `#${t}`).join(' ')
  const note = m.notes?.split('\n')[0].trim() ?? ''
  return [tags, note].filter(Boolean).join(' · ')
}

const even = (n: number): number => Math.max(16, Math.round(n / 2) * 2)

/**
 * Собирает запрос экспорта: для каждого момента — видео, на котором он идёт, и картинки рисунков
 * (в размере кадра этого видео), подпись и схема площадки (в размере выходного кадра).
 * Моменты, которых нет ни на одном видео, пропускаются.
 */
export async function buildExportRequest(
  project: Project,
  moments: Moment[],
  options: ExportOptions,
  meta: (v: ProjectVideo) => Promise<VideoMeta>,
  preferVideoId: string,
  suggestedName: string,
  /** Видео, на которых можно искать моменты (без ненайденных); рисунки сверяются по полному проекту. */
  available: ProjectVideo[] = project.videos
): Promise<{ request: ExportRequest; skipped: number }> {
  const located = moments.map((m) => ({ m, v: locateMoment(available, m, preferVideoId) }))
  const usable = located.filter((x): x is { m: Moment; v: ProjectVideo } => x.v !== null)
  if (!usable.length) throw new Error('Нет моментов, которые попадают в видео проекта')

  const metas = new Map<string, VideoMeta>()
  for (const { v } of usable) if (!metas.has(v.id)) metas.set(v.id, await meta(v))
  const first = metas.get(usable[0].v.id)!
  const width = even(first.width)
  const height = even(first.height)

  const clips: ExportClip[] = []
  for (const { m, v } of usable) {
    // картинки рисуются синхронно и в полном разрешении — между клипами отдаём поток интерфейсу
    await new Promise((r) => setTimeout(r))
    const vm = metas.get(v.id)!
    const overlays = options.holdSeconds > 0
      ? (m.drawings ?? [])
          .filter((d) => drawingVideoId(project, d) === v.id && d.time >= m.start && d.time <= m.end)
          .map((d) => ({ time: d.time - v.offset, png: renderShapesPng(d.shapes, vm.width, vm.height) }))
      : []
    const clip: ExportClip = {
      title: m.title,
      videoPath: v.path,
      start: Math.max(0, m.start - v.offset),
      end: Math.max(0, m.end - v.offset),
      width: vm.width,
      height: vm.height,
      fps: vm.fps,
      overlays
    }
    if (options.captions) clip.captionPng = renderCaptionPng(m.title, captionSubtitle(m), width, height)
    if (options.boards && options.holdSeconds > 0 && m.board?.length) clip.boardPng = renderBoardPng(m.board, width, height)
    clips.push(clip)
  }

  return {
    request: { clips, mode: options.mode, holdSeconds: options.holdSeconds, width, height, fps: first.fps, suggestedName },
    skipped: moments.length - usable.length
  }
}
