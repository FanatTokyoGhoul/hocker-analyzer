import { describe, expect, it } from 'vitest'
import type { VideoInfo } from '../../../shared/types'
import { buildRemoteState, type RemoteInput } from './remoteState'

const info = { path: '/secret/match.mp4', url: 'media://x', fps: 30, duration: 20, width: 1920, height: 1080 } as VideoInfo
const input: RemoteInput = {
  title: 'match.hockey.json',
  info,
  clock: { time: 3.05, paused: true, rate: 0.5, duration: 20 },
  fps: 30,
  videos: [{ id: 'v1', path: '/secret/match.mp4', label: 'Видео 1', offset: 0, fps: 30 }],
  activeId: 'v1',
  moments: [{ id: 'm', title: 'Гол', start: 2, end: 4, notes: 'n', drawings: [{ time: 3, shapes: [{ id: 's', kind: 'line', points: [0, 0, 1, 1], color: '#fff' }] }] }],
  activeMomentId: 'm',
  playlist: { ids: ['m', 'x'], index: 1 },
  hold: false,
  draft: { start: 1, end: null },
  quickTags: [{ id: 'q', label: 'Гол', tag: 'гол', before: 5, after: 3 }],
  canDraw: true,
  drawHint: null,
  shapes: [],
  color: '#ff3b30',
  recentColors: ['#123456', '#ff3b30'],
  stepMs: 100,
  notice: null
}

describe('состояние для пульта', () => {
  it('кадр, моменты, плейлист и цвета', () => {
    const s = buildRemoteState(input)
    expect(s).toMatchObject({ ready: true, frame: 91, aspect: 1920 / 1080, paused: true, rate: 0.5 })
    expect(s.frameKey).toMatch(/^v1:[0-9a-z]+:91$/)
    // другой файл того же видео (после конвертации) — другой ключ
    expect(buildRemoteState({ ...input, info: { ...info, path: '/secret/match.h264.mp4' } }).frameKey).not.toBe(s.frameKey)
    expect(s.moments).toEqual([{ id: 'm', title: 'Гол', start: 2, end: 4, tags: [], notes: 'n', shapes: 1 }])
    expect(s.playlist).toEqual({ index: 1, total: 2 })
    expect(s.quickTags).toEqual([{ label: 'Гол' }])
    expect(s.colors).toContain('#123456')
    expect(new Set(s.colors).size).toBe(s.colors.length)
  })

  it('пути к файлам на телефон не уходят', () => {
    expect(JSON.stringify(buildRemoteState(input))).not.toContain('/secret')
  })

  it('без видео — не готово; запасные значения', () => {
    expect(buildRemoteState({ ...input, info: null })).toMatchObject({ ready: false, videoId: null, aspect: 16 / 9 })
    const s = buildRemoteState({ ...input, clock: { ...input.clock, duration: 0 }, playlist: null, moments: [{ id: 'x', title: 'x', start: 0, end: 1, notes: '' }] })
    expect(s.duration).toBe(20)
    expect(s.playlist).toBeNull()
    expect(s.moments[0]).toEqual({ id: 'x', title: 'x', start: 0, end: 1, tags: [], shapes: 0 })
  })
})
