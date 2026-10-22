import { describe, expect, it } from 'vitest'
import type { Moment, Shape } from '../../../shared/types'
import { HISTORY_LIMIT, collectTags, initialProjectState, momentAt, parseTags, projectReducer, redoLabel, undoLabel, type ProjectState } from './projectState'

const video = (id: string, offset = 0) => ({ id, path: `/${id}.mp4`, label: id, offset, fps: 25 })
const base = (): ProjectState => projectReducer(initialProjectState, { type: 'new', video: video('v1') })
const moment = (id: string, start: number, end: number, extra: Partial<Moment> = {}): Moment => ({ id, title: id, start, end, ...extra })
const arrow = (id: string): Shape => ({ id, kind: 'arrow', points: [0, 0, 1, 1], color: '#f00' })

describe('projectReducer', () => {
  it('добавляет моменты отсортированными и исправляет перевёрнутый отрезок', () => {
    let s = base()
    s = projectReducer(s, { type: 'addMoment', moment: moment('b', 30, 40) })
    s = projectReducer(s, { type: 'addMoment', moment: moment('a', 25, 10) })
    expect(s.project!.moments.map((m) => [m.id, m.start, m.end])).toEqual([['a', 10, 25], ['b', 30, 40]])
    expect(s.dirty).toBe(true)
  })

  it('пересортировывает при изменении границ и сбрасывает dirty после сохранения', () => {
    let s = base()
    s = projectReducer(s, { type: 'addMoment', moment: moment('a', 1, 2) })
    s = projectReducer(s, { type: 'addMoment', moment: moment('b', 5, 6) })
    s = projectReducer(s, { type: 'updateMoment', id: 'a', patch: { start: 7, end: 8 } })
    expect(s.project!.moments.map((m) => m.id)).toEqual(['b', 'a'])
    s = projectReducer(s, { type: 'saved', path: '/p.json', project: s.project! })
    expect(s).toMatchObject({ dirty: false, projectPath: '/p.json' })
  })

  it('группирует фигуры по кадру, отменяет и очищает', () => {
    let s = base()
    s = projectReducer(s, { type: 'addMoment', moment: moment('a', 0, 10) })
    const tol = 0.02
    s = projectReducer(s, { type: 'addShape', momentId: 'a', time: 5, shape: arrow('1'), tolerance: tol, videoId: 'v1' })
    s = projectReducer(s, { type: 'addShape', momentId: 'a', time: 5.01, shape: arrow('2'), tolerance: tol, videoId: 'v1' })
    s = projectReducer(s, { type: 'addShape', momentId: 'a', time: 2, shape: arrow('3'), tolerance: tol, videoId: 'v1' })
    expect(s.project!.moments[0].drawings!.map((d) => [d.time, d.shapes.length])).toEqual([[2, 1], [5, 2]])

    s = projectReducer(s, { type: 'undoShape', momentId: 'a', time: 5, tolerance: tol, videoId: 'v1' })
    expect(s.project!.moments[0].drawings![1].shapes.map((x) => x.id)).toEqual(['1'])

    s = projectReducer(s, { type: 'clearShapes', momentId: 'a', time: 5, tolerance: tol, videoId: 'v1' })
    expect(s.project!.moments[0].drawings!.map((d) => d.time)).toEqual([2])
  })

  it('не помечает проект изменённым, если отменять нечего', () => {
    let s = base()
    s = projectReducer(s, { type: 'addMoment', moment: moment('a', 0, 10) })
    s = projectReducer(s, { type: 'saved', path: '/p.json', project: s.project! })
    const after = projectReducer(s, { type: 'undoShape', momentId: 'a', time: 3, tolerance: 0.02, videoId: 'v1' })
    expect(after).toBe(s)
  })
})

describe('история правок', () => {
  it('undo/redo, dirty относительно сохранённой версии', () => {
    let s = base()
    expect(s.dirty).toBe(false)
    s = projectReducer(s, { type: 'addMoment', moment: moment('a', 0, 10) })
    const saved = s.project!
    s = projectReducer(s, { type: 'saved', path: '/p.json', project: saved })
    s = projectReducer(s, { type: 'deleteMoment', id: 'a' })
    expect(s.dirty).toBe(true)
    expect(undoLabel(s)).toBe('удаление момента')
    s = projectReducer(s, { type: 'undo' })
    expect(s.project).toBe(saved)
    expect(s.dirty).toBe(false)
    expect(redoLabel(s)).toBe('удаление момента')
    s = projectReducer(s, { type: 'redo' })
    expect(s.project!.moments).toEqual([])
    // новая правка обрезает «будущее»
    s = projectReducer(s, { type: 'undo' })
    s = projectReducer(s, { type: 'updateMoment', id: 'a', patch: { title: 'x' } })
    expect(s.future).toEqual([])
    expect(projectReducer(s, { type: 'redo' })).toBe(s)
  })

  it('пустые правки не попадают в историю', () => {
    let s = base()
    s = projectReducer(s, { type: 'addMoment', moment: moment('a', 0, 10, { notes: 'n' }) })
    const n = s.past.length
    expect(projectReducer(s, { type: 'updateMoment', id: 'a', patch: { title: 'a' } })).toBe(s)
    expect(projectReducer(s, { type: 'setPeriods', periods: [] })).toBe(s)
    expect(projectReducer(s, { type: 'setBoard', momentId: 'a', shapes: [] })).toBe(s)
    s = projectReducer(s, { type: 'updateMoment', id: 'a', patch: { notes: '  ' } })
    expect(s.project!.moments[0]).not.toHaveProperty('notes')
    expect(s.past.length).toBe(n + 1)
  })

  it('история ограничена: самые старые шаги отбрасываются', () => {
    let s = base()
    for (let i = 0; i <= HISTORY_LIMIT; i++) s = projectReducer(s, { type: 'addMoment', moment: moment(`m${i}`, i, i + 1) })
    expect(s.past).toHaveLength(HISTORY_LIMIT)
    // первый шаг (пустой проект) уже не вернуть
    expect(s.past[0].project.moments).toHaveLength(1)
  })

  it('схема момента: появляется и убирается целиком', () => {
    let s = base()
    s = projectReducer(s, { type: 'addMoment', moment: moment('a', 0, 10) })
    s = projectReducer(s, { type: 'setBoard', momentId: 'a', shapes: [arrow('b')] })
    expect(s.project!.moments[0].board).toEqual([arrow('b')])
    expect(undoLabel(s)).toBe('схема площадки')
    s = projectReducer(s, { type: 'setBoard', momentId: 'a', shapes: [] })
    expect(s.project!.moments[0]).not.toHaveProperty('board')
  })

  it('восстановленный черновик сразу «грязный», а load сбрасывает историю', () => {
    let s = base()
    s = projectReducer(s, { type: 'addMoment', moment: moment('a', 0, 10) })
    s = projectReducer(s, { type: 'load', project: s.project!, path: null, restored: true })
    expect(s).toMatchObject({ dirty: true, past: [], future: [] })
  })
})

describe('несколько видео', () => {
  it('рисунки разделены по видео; удаление видео убирает его рисунки', () => {
    let s = base()
    s = projectReducer(s, { type: 'addVideo', video: video('v2') })
    s = projectReducer(s, { type: 'addMoment', moment: moment('a', 0, 10) })
    const t = { momentId: 'a', time: 5, tolerance: 0.02 }
    s = projectReducer(s, { type: 'addShape', ...t, videoId: 'v1', shape: arrow('1') })
    s = projectReducer(s, { type: 'addShape', ...t, videoId: 'v2', shape: arrow('2') })
    expect(s.project!.moments[0].drawings).toEqual([
      { time: 5, shapes: [arrow('1')] },
      { time: 5, shapes: [arrow('2')], videoId: 'v2' }
    ])
    s = projectReducer(s, { type: 'removeVideo', id: 'v1' })
    expect(s.project!.videos.map((v) => v.id)).toEqual(['v2'])
    expect(s.project!.videoPath).toBe('/v2.mp4')
    // у нового первого видео videoId не нужен
    expect(s.project!.moments[0].drawings).toEqual([{ time: 5, shapes: [arrow('2')] }])
    // последнее видео удалить нельзя
    expect(projectReducer(s, { type: 'removeVideo', id: 'v2' })).toBe(s)
  })

  it('удаление не первого видео убирает только его рисунки', () => {
    let s = base()
    s = projectReducer(s, { type: 'addVideo', video: video('v2') })
    s = projectReducer(s, { type: 'addMoment', moment: moment('a', 0, 10) })
    const t = { momentId: 'a', time: 5, tolerance: 0.02 }
    s = projectReducer(s, { type: 'addShape', ...t, videoId: 'v1', shape: arrow('1') })
    s = projectReducer(s, { type: 'addShape', ...t, videoId: 'v2', shape: arrow('2') })
    s = projectReducer(s, { type: 'removeVideo', id: 'v2' })
    expect(s.project!.moments[0].drawings).toEqual([{ time: 5, shapes: [arrow('1')] }])
    expect(projectReducer(s, { type: 'removeVideo', id: 'nope' })).toBe(s)
  })

  it('updateVideo синхронизирует videoPath/fps первого видео', () => {
    let s = base()
    s = projectReducer(s, { type: 'updateVideo', id: 'v1', patch: { path: '/new.mp4', fps: 30 } })
    expect(s.project).toMatchObject({ videoPath: '/new.mp4', fps: 30 })
    expect(projectReducer(s, { type: 'updateVideo', id: 'v1', patch: { fps: 30 } })).toBe(s)
  })

  it('новый сдвиг видео переносит его рисунки вместе с кадрами', () => {
    let s = base()
    s = projectReducer(s, { type: 'addVideo', video: video('v2', 5) })
    s = projectReducer(s, { type: 'addMoment', moment: moment('a', 0, 10) })
    const t = { momentId: 'a', time: 6, tolerance: 0.02 }
    s = projectReducer(s, { type: 'addShape', ...t, videoId: 'v1', shape: arrow('1') })
    s = projectReducer(s, { type: 'addShape', ...t, videoId: 'v2', shape: arrow('2') })
    s = projectReducer(s, { type: 'updateVideo', id: 'v2', patch: { offset: 7.5 } })
    expect(s.project!.moments[0].drawings!.map((d) => [d.videoId ?? 'v1', d.time])).toEqual([
      ['v1', 6],
      ['v2', 8.5]
    ])
    // одна правка — один шаг истории
    expect(projectReducer(s, { type: 'undo' }).project!.moments[0].drawings![1].time).toBe(6)
  })

  it('периоды нормализуются', () => {
    const s = projectReducer(base(), { type: 'setPeriods', periods: [1200, 600, 600, -3] })
    expect(s.project!.periods).toEqual([600, 1200])
  })
})

describe('вспомогательные функции', () => {
  it('momentAt выбирает позже начавшийся при пересечении', () => {
    const ms = [moment('a', 0, 10), moment('b', 5, 15)]
    expect(momentAt(ms, 7)!.id).toBe('b')
    expect(momentAt(ms, 2)!.id).toBe('a')
    expect(momentAt(ms, 20)).toBeNull()
  })

  it('теги', () => {
    expect(parseTags(' перепасовка, гол ,, гол')).toEqual(['перепасовка', 'гол'])
    expect(collectTags([moment('a', 0, 1, { tags: ['я', 'а'] }), moment('b', 0, 1, { tags: ['а'] })])).toEqual(['а', 'я'])
  })
})

describe('правка фигур и свободные схемы', () => {
  const target = { momentId: 'm', time: 1.02, videoId: 'v1', tolerance: 0.02 }

  it('updateShape меняет фигуру по id в любом рисунке, deleteShape убирает её и пустой рисунок', () => {
    let s = base()
    s = projectReducer(s, { type: 'addMoment', moment: moment('m', 0, 5) })
    s = projectReducer(s, { type: 'addShape', ...target, shape: arrow('s1') })
    s = projectReducer(s, { type: 'addShape', ...target, time: 2.02, shape: arrow('s2') })
    s = projectReducer(s, { type: 'updateShape', shape: { ...arrow('s2'), color: '#00f' } })
    expect(s.project!.moments[0].drawings![1].shapes[0].color).toBe('#00f')
    expect(undoLabel(s)).toBe('изменение фигуры')
    s = projectReducer(s, { type: 'deleteShape', shapeId: 's1' })
    expect(s.project!.moments[0].drawings!.map((d) => d.time)).toEqual([2.02])
    expect(undoLabel(s)).toBe('удаление фигуры')
    // неизвестная фигура — ничего не меняется и в историю не попадает
    const same = projectReducer(s, { type: 'deleteShape', shapeId: 'nope' })
    expect(same).toBe(s)
    s = projectReducer(s, { type: 'undo' })
    expect(s.project!.moments[0].drawings!.length).toBe(2)
  })

  it('добавляет, переименовывает и удаляет схемы; последняя удалённая убирает поле', () => {
    let s = base()
    s = projectReducer(s, { type: 'addBoard', board: { id: 'b1', title: 'Схема 1', shapes: [] } })
    s = projectReducer(s, { type: 'updateBoard', id: 'b1', patch: { title: 'Выход из зоны', shapes: [arrow('x')] } })
    expect(s.project!.boards).toEqual([{ id: 'b1', title: 'Выход из зоны', shapes: [arrow('x')] }])
    expect(projectReducer(s, { type: 'updateBoard', id: 'b1', patch: { title: 'Выход из зоны' } })).toBe(s)
    s = projectReducer(s, { type: 'removeBoard', id: 'b1' })
    expect('boards' in s.project!).toBe(false)
    s = projectReducer(s, { type: 'undo' })
    expect(s.project!.boards![0].title).toBe('Выход из зоны')
  })
})
