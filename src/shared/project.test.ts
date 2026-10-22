import { describe, expect, it } from 'vitest'
import { parseProject, serializeProject } from './project'

describe('parseProject', () => {
  it('принимает формат из брифа и делает round-trip', () => {
    const raw = {
      videoPath: '/match.mp4',
      fps: 29.97,
      moments: [
        {
          id: 'm1',
          title: 'хорошая перепасовка',
          start: 78,
          end: 85,
          tags: ['пас'],
          drawings: [{ time: 80, shapes: [{ id: 's', kind: 'arrow', points: [0.1, 0.2, 0.3, 0.4], color: '#ff0' }] }]
        }
      ]
    }
    const p = parseProject(raw)
    expect(p).toEqual({ ...raw, version: 2, videos: [{ id: 'v1', path: '/match.mp4', label: 'Видео 1', offset: 0, fps: 29.97 }] })
    expect(parseProject(JSON.parse(serializeProject(p)))).toEqual(p)
  })

  it('отбрасывает битые фигуры и чинит границы', () => {
    const p = parseProject({
      videoPath: '/v.mp4',
      moments: [{ start: 10, end: 5, drawings: [{ time: 1, shapes: [{ kind: 'blob' }] }] }]
    })
    expect(p.fps).toBe(30)
    expect(p.moments[0]).toMatchObject({ start: 5, end: 10, title: 'Момент 1', drawings: [] })
  })

  it('отклоняет неверный формат', () => {
    expect(() => parseProject(null)).toThrow()
    expect(() => parseProject({ moments: [] })).toThrow()
    expect(() => parseProject({ videoPath: '/v', moments: [{ title: 'x' }] })).toThrow()
  })

  it('v2: несколько видео, заметки, схема, периоды, новые фигуры', () => {
    const raw = {
      version: 2,
      videoPath: '/p1.mp4',
      fps: 25,
      videos: [
        { id: 'a', path: '/p1.mp4', label: 'Период 1', offset: 0, fps: 25 },
        { id: 'a', path: '/p2.mp4', label: '', offset: -5, fps: 0 },
        { path: 7 }
      ],
      periods: [1200, 'x', 600, 600, -1],
      moments: [
        {
          id: 'm',
          title: 't',
          start: 1,
          end: 2,
          notes: 'держать дальнюю штангу',
          board: [{ id: 'b', kind: 'zone', points: [0, 0, 1, 0, 1, 1], color: '#fff' }],
          drawings: [
            {
              time: 1.5,
              videoId: 'a_',
              shapes: [
                { id: 'p', kind: 'arrow', points: [0, 0, 1, 1], color: '#f00', dashed: true },
                { id: 's', kind: 'spotlight', x: 0.5, y: 0.5, rx: 0.1, ry: 0.2, color: '#ff0' },
                { id: 'x', kind: 'text', x: 0.1, y: 0.1, text: '  1  ', color: '#fff' },
                { id: 'z', kind: 'zone', points: [0, 0, 1, 1], color: '#fff' },
                { id: 'e', kind: 'text', x: 0, y: 0, text: '   ', color: '#fff' }
              ]
            },
            { time: 1.6, videoId: 'gone', shapes: [{ id: 'l', kind: 'line', points: [0, 0, 1, 1], color: '#f00' }] }
          ]
        }
      ]
    }
    const p = parseProject(raw)
    expect(p.videos).toEqual([
      { id: 'a', path: '/p1.mp4', label: 'Период 1', offset: 0, fps: 25 },
      { id: 'a_', path: '/p2.mp4', label: 'Видео 2', offset: -5, fps: 25 }
    ])
    expect(p.periods).toEqual([600, 1200])
    const m = p.moments[0]
    expect(m.notes).toBe('держать дальнюю штангу')
    expect(m.board).toHaveLength(1)
    expect(m.drawings![0].videoId).toBe('a_')
    expect(m.drawings![0].shapes.map((s) => s.kind)).toEqual(['arrow', 'spotlight', 'text'])
    expect(m.drawings![0].shapes[0]).toMatchObject({ dashed: true })
    expect(m.drawings![0].shapes[2]).toMatchObject({ text: '1' })
    expect(m.drawings![1].videoId).toBeUndefined()
    const again = parseProject(JSON.parse(serializeProject(p)))
    expect(again).toEqual(p)
    expect(JSON.parse(serializeProject(p))).toMatchObject({ videoPath: '/p1.mp4', fps: 25, version: 2 })
  })

  it('читает свободные схемы: битые отбрасывает, повторы id и пустые названия исправляет', () => {
    const p = parseProject({
      videoPath: '/a.mp4',
      moments: [],
      boards: [
        { id: 'b', title: ' Выход ', shapes: [{ id: 's', kind: 'arrow', points: [0, 0, 1, 1], color: '#fff' }, { kind: 'bad' }] },
        { id: 'b', title: '', shapes: 'x' },
        'мусор'
      ]
    })
    expect(p.boards).toEqual([
      { id: 'b', title: 'Выход', shapes: [{ id: 's', kind: 'arrow', points: [0, 0, 1, 1], color: '#fff' }] },
      { id: 'b_1', title: 'Схема 2', shapes: [] }
    ])
    expect(parseProject(JSON.parse(serializeProject(p))).boards).toEqual(p.boards)
    expect('boards' in parseProject({ videoPath: '/a.mp4', moments: [] })).toBe(false)
  })

  it('ограничивает число схем и длину id', () => {
    const boards = Array.from({ length: 600 }, () => ({ id: 'x'.repeat(100), title: 't', shapes: [] }))
    const p = parseProject({ videoPath: '/a.mp4', moments: [], boards })
    expect(p.boards).toHaveLength(500)
    expect(new Set(p.boards!.map((b) => b.id)).size).toBe(500)
    expect(p.boards![0].id).toHaveLength(64)
  })
})
