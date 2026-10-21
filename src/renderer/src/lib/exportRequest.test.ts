import { describe, expect, it, vi } from 'vitest'
import type { Moment, Project, ProjectVideo } from '../../../shared/types'

// картинки рисует Konva в браузере — в тестах важно только, что и в каком размере просили нарисовать
vi.mock('./shapeRender', () => ({
  renderShapesPng: (shapes: unknown[], w: number, h: number) => `shapes:${shapes.length}:${w}x${h}`,
  renderBoardPng: (shapes: unknown[], w: number, h: number) => `board:${shapes.length}:${w}x${h}`,
  renderCaptionPng: (title: string, sub: string, w: number, h: number) => `caption:${title}|${sub}:${w}x${h}`
}))

const { buildExportRequest, captionSubtitle } = await import('./exportRequest')

const arrow = { id: 's', kind: 'arrow' as const, points: [0, 0, 1, 1] as [number, number, number, number], color: '#f00' }
const v1: ProjectVideo = { id: 'v1', path: '/p1.mp4', label: 'П1', offset: 0, fps: 30, duration: 100 }
const v2: ProjectVideo = { id: 'v2', path: '/p2.mp4', label: 'П2', offset: 100, fps: 25, duration: 100 }
const meta = async (v: ProjectVideo) => (v.id === 'v1' ? { width: 1921, height: 1081, fps: 30 } : { width: 1280, height: 720, fps: 25 })

const moments: Moment[] = [
  {
    id: 'a',
    title: 'Гол',
    start: 10,
    end: 20,
    tags: ['гол', 'пп'],
    notes: 'первая строка\nвторая',
    board: [arrow],
    drawings: [
      { time: 15, shapes: [arrow] },
      { time: 25, shapes: [arrow] }, // вне момента
      { time: 16, shapes: [arrow], videoId: 'v2' } // нарисовано на другом видео
    ]
  },
  { id: 'b', title: 'Бросок', start: 110, end: 115, drawings: [{ time: 112, shapes: [arrow, arrow], videoId: 'v2' }] },
  { id: 'c', title: 'Вне видео', start: 500, end: 510 }
]
const project: Project = { videoPath: v1.path, fps: 30, videos: [v1, v2], moments }
const opts = { mode: 'single' as const, holdSeconds: 3, captions: true, boards: true }

describe('запрос экспорта', () => {
  it('подзаголовок подписи: теги и первая строка заметки', () => {
    expect(captionSubtitle(moments[0])).toBe('#гол #пп · первая строка')
    expect(captionSubtitle({ id: 'x', title: 'x', start: 0, end: 1 })).toBe('')
  })

  it('клипы в локальном времени своих видео, рисунки только этого видео и момента', async () => {
    const { request, skipped } = await buildExportRequest(project, moments, opts, meta, 'v1', 'подборка')
    expect(skipped).toBe(1)
    // выход — размер первого видео, округлённый до чётного
    expect(request).toMatchObject({ width: 1922, height: 1082, fps: 30, holdSeconds: 3, suggestedName: 'подборка' })
    const [a, b] = request.clips
    expect(a).toMatchObject({ videoPath: '/p1.mp4', start: 10, end: 20, width: 1921, height: 1081 })
    expect(a.overlays).toEqual([{ time: 15, png: 'shapes:1:1921x1081' }])
    expect(a.boardPng).toBe('board:1:1922x1082')
    expect(a.captionPng).toBe('caption:Гол|#гол #пп · первая строка:1922x1082')
    expect(b).toMatchObject({ videoPath: '/p2.mp4', start: 10, end: 15, fps: 25 })
    expect(b.overlays).toEqual([{ time: 12, png: 'shapes:2:1280x720' }])
    expect(b.boardPng).toBeUndefined()
  })

  it('без стоп-кадров нет ни рисунков, ни схемы; подписи по желанию', async () => {
    const { request } = await buildExportRequest(project, moments.slice(0, 1), { ...opts, holdSeconds: 0, captions: false }, meta, 'v1', 'x')
    expect(request.clips[0].overlays).toEqual([])
    expect(request.clips[0].boardPng).toBeUndefined()
    expect(request.clips[0].captionPng).toBeUndefined()
  })

  it('недоступное видео: рисунки первого видео не переезжают на другое', async () => {
    // первое видео не нашлось — момент ищется только среди доступных
    const { request } = await buildExportRequest(project, moments.slice(0, 1), opts, meta, 'v2', 'x', [{ ...v2, offset: 0 }])
    expect(request.clips[0].videoPath).toBe('/p2.mp4')
    expect(request.clips[0].overlays).toEqual([{ time: 16, png: 'shapes:1:1280x720' }])
  })

  it('ни один момент не попал в видео — ошибка', async () => {
    await expect(buildExportRequest(project, moments.slice(2), opts, meta, 'v1', 'x')).rejects.toThrow()
  })
})
