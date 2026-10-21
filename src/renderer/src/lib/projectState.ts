import type { Moment, Project, ProjectVideo, Shape } from '../../../shared/types'
import { normalizePeriodStarts } from '../../../shared/project'

type HistoryEntry = { project: Project; label: string }

export type ProjectState = {
  project: Project | null
  projectPath: string | null
  /** Последняя сохранённая версия: dirty — когда текущий проект отличается от неё. */
  savedProject: Project | null
  dirty: boolean
  past: HistoryEntry[]
  future: HistoryEntry[]
}

export const HISTORY_LIMIT = 200

/** Рисунок привязан к кадрам конкретного видео. */
type ShapeTarget = { momentId: string; time: number; videoId: string; tolerance: number }

export type ProjectAction =
  | { type: 'new'; video: ProjectVideo }
  | { type: 'load'; project: Project; path: string | null; restored?: boolean }
  | { type: 'saved'; path: string; project: Project }
  | { type: 'addVideo'; video: ProjectVideo }
  | { type: 'updateVideo'; id: string; patch: Partial<Omit<ProjectVideo, 'id'>> }
  | { type: 'removeVideo'; id: string }
  | { type: 'addMoment'; moment: Moment }
  | { type: 'updateMoment'; id: string; patch: Partial<Omit<Moment, 'id' | 'drawings' | 'board'>> }
  | { type: 'deleteMoment'; id: string }
  | ({ type: 'addShape'; shape: Shape } & ShapeTarget)
  | ({ type: 'undoShape' } & ShapeTarget)
  | ({ type: 'clearShapes' } & ShapeTarget)
  | { type: 'setBoard'; momentId: string; shapes: Shape[] }
  | { type: 'setPeriods'; periods: number[] }
  | { type: 'undo' }
  | { type: 'redo' }

type EditAction = Exclude<ProjectAction, { type: 'new' | 'load' | 'saved' | 'undo' | 'redo' }>

const LABELS: Record<EditAction['type'], string> = {
  addVideo: 'добавление видео',
  updateVideo: 'изменение видео',
  removeVideo: 'удаление видео',
  addMoment: 'добавление момента',
  updateMoment: 'изменение момента',
  deleteMoment: 'удаление момента',
  addShape: 'рисунок',
  undoShape: 'удаление фигуры',
  clearShapes: 'очистка кадра',
  setBoard: 'схема площадки',
  setPeriods: 'периоды'
}

export const initialProjectState: ProjectState = {
  project: null,
  projectPath: null,
  savedProject: null,
  dirty: false,
  past: [],
  future: []
}

export function sortMoments(moments: Moment[]): Moment[] {
  return [...moments].sort((a, b) => a.start - b.start || a.end - b.end)
}

function normalizeRange(m: Moment): Moment {
  return m.start <= m.end ? m : { ...m, start: m.end, end: m.start }
}

/** Рисунки первого видео хранятся без videoId (так их понимают проекты v1). */
export const drawingVideoId = (project: Project, d: { videoId?: string }): string => d.videoId ?? project.videos[0]?.id ?? ''

/** Рисунок «на этом кадре» этого видео — ближайший по времени в пределах полукадра. */
export function findDrawingIndex(project: Project, m: Moment, time: number, tolerance: number, videoId: string): number {
  return (m.drawings ?? []).findIndex((d) => drawingVideoId(project, d) === videoId && Math.abs(d.time - time) <= tolerance)
}

function mapMoments(project: Project, id: string, fn: (m: Moment) => Moment): Project {
  let changed = false
  const moments = project.moments.map((m) => {
    if (m.id !== id) return m
    const next = fn(m)
    changed ||= next !== m
    return next
  })
  return changed ? { ...project, moments } : project
}

function editShapes(project: Project, m: Moment, t: ShapeTarget, fn: (shapes: Shape[]) => Shape[]): Moment {
  const drawings = [...(m.drawings ?? [])]
  const i = findDrawingIndex(project, m, t.time, t.tolerance, t.videoId)
  const current = i >= 0 ? drawings[i].shapes : []
  const shapes = fn(current)
  if (shapes === current) return m
  if (shapes.length === 0) {
    if (i >= 0) drawings.splice(i, 1)
  } else if (i >= 0) {
    drawings[i] = { ...drawings[i], shapes }
  } else {
    const primary = t.videoId === project.videos[0]?.id
    drawings.push(primary ? { time: t.time, shapes } : { time: t.time, shapes, videoId: t.videoId })
    drawings.sort((a, b) => a.time - b.time)
  }
  return { ...m, drawings }
}

/** Применяет правку к проекту; возвращает тот же объект, если ничего не изменилось. */
function edit(project: Project, action: EditAction): Project {
  switch (action.type) {
    case 'addVideo':
      return { ...project, videos: [...project.videos, action.video] }
    case 'updateVideo': {
      let changed = false
      const videos = project.videos.map((v) => {
        if (v.id !== action.id) return v
        const next = { ...v, ...action.patch }
        changed = (Object.keys(action.patch) as (keyof ProjectVideo)[]).some((k) => next[k] !== v[k])
        return changed ? next : v
      })
      if (!changed) return project
      const first = videos[0]
      const before = project.videos.find((v) => v.id === action.id)!
      const shift = 'offset' in action.patch ? videos.find((v) => v.id === action.id)!.offset - before.offset : 0
      // рисунки привязаны к кадрам видео: при новом сдвиге их время проекта сдвигается вместе с ним
      const moments = shift
        ? project.moments.map((m) =>
            m.drawings?.some((d) => drawingVideoId(project, d) === action.id)
              ? { ...m, drawings: m.drawings.map((d) => (drawingVideoId(project, d) === action.id ? { ...d, time: d.time + shift } : d)) }
              : m
          )
        : project.moments
      return { ...project, videos, moments, videoPath: first.path, fps: first.fps }
    }
    case 'removeVideo': {
      if (project.videos.length < 2 || !project.videos.some((v) => v.id === action.id)) return project
      const removedId = action.id
      const videos = project.videos.filter((v) => v.id !== removedId)
      const newFirst = videos[0].id
      const moments = project.moments.map((m) => {
        if (!m.drawings?.length) return m
        // рисунки удалённого видео пропадают; рисунки нового «первого» видео теряют явный videoId
        const drawings = m.drawings
          .filter((d) => drawingVideoId(project, d) !== removedId)
          .map((d) => (d.videoId === newFirst ? { time: d.time, shapes: d.shapes } : d))
        return { ...m, drawings }
      })
      return { ...project, videos, moments, videoPath: videos[0].path, fps: videos[0].fps }
    }
    case 'addMoment':
      return { ...project, moments: sortMoments([...project.moments, normalizeRange(action.moment)]) }
    case 'updateMoment': {
      const patch = { ...action.patch }
      if ('notes' in patch && !patch.notes?.trim()) patch.notes = undefined
      const next = mapMoments(project, action.id, (m) => {
        const merged = normalizeRange({ ...m, ...patch })
        if (merged.notes === undefined) delete merged.notes
        const same = (Object.keys(merged) as (keyof Moment)[]).every((k) => merged[k] === m[k]) && Object.keys(m).length === Object.keys(merged).length
        return same ? m : merged
      })
      const timing = 'start' in patch || 'end' in patch
      return timing && next !== project ? { ...next, moments: sortMoments(next.moments) } : next
    }
    case 'deleteMoment':
      return project.moments.some((m) => m.id === action.id)
        ? { ...project, moments: project.moments.filter((m) => m.id !== action.id) }
        : project
    case 'addShape':
      return mapMoments(project, action.momentId, (m) => editShapes(project, m, action, (s) => [...s, action.shape]))
    case 'undoShape':
      return mapMoments(project, action.momentId, (m) => editShapes(project, m, action, (s) => (s.length ? s.slice(0, -1) : s)))
    case 'clearShapes':
      return mapMoments(project, action.momentId, (m) => editShapes(project, m, action, (s) => (s.length ? [] : s)))
    case 'setBoard':
      return mapMoments(project, action.momentId, (m) => {
        if (m.board === action.shapes || (!m.board?.length && !action.shapes.length)) return m
        if (action.shapes.length) return { ...m, board: action.shapes }
        const { board: _removed, ...rest } = m
        return rest
      })
    case 'setPeriods': {
      const periods = normalizePeriodStarts(action.periods)
      const current = project.periods ?? []
      if (periods.length === current.length && periods.every((p, i) => p === current[i])) return project
      if (periods.length) return { ...project, periods }
      const { periods: _removed, ...rest } = project
      return rest
    }
  }
}

const withProject = (state: ProjectState, project: Project | null, past: HistoryEntry[], future: HistoryEntry[]): ProjectState => ({
  ...state,
  project,
  past,
  future,
  dirty: project !== state.savedProject
})

export function projectReducer(state: ProjectState, action: ProjectAction): ProjectState {
  switch (action.type) {
    case 'new': {
      const v = action.video
      const project: Project = { version: 2, videoPath: v.path, fps: v.fps, videos: [v], moments: [] }
      return { ...initialProjectState, project, savedProject: project }
    }
    case 'load':
      // восстановленный черновик не сохранён — сразу «грязный»
      return { ...initialProjectState, project: action.project, projectPath: action.path, savedProject: action.restored ? null : action.project, dirty: !!action.restored }
    case 'saved':
      return { ...state, projectPath: action.path, savedProject: action.project, dirty: state.project !== action.project }
    case 'undo': {
      const entry = state.past[state.past.length - 1]
      if (!entry || !state.project) return state
      return withProject(state, entry.project, state.past.slice(0, -1), [...state.future, { project: state.project, label: entry.label }])
    }
    case 'redo': {
      const entry = state.future[state.future.length - 1]
      if (!entry || !state.project) return state
      return withProject(state, entry.project, [...state.past, { project: state.project, label: entry.label }], state.future.slice(0, -1))
    }
    default: {
      if (!state.project) return state
      const next = edit(state.project, action)
      if (next === state.project) return state
      const past = [...state.past, { project: state.project, label: LABELS[action.type] }].slice(-HISTORY_LIMIT)
      return withProject(state, next, past, [])
    }
  }
}

/** Что отменит/повторит следующий шаг — для подсказок и уведомлений. */
export const undoLabel = (s: ProjectState): string | null => s.past[s.past.length - 1]?.label ?? null
export const redoLabel = (s: ProjectState): string | null => s.future[s.future.length - 1]?.label ?? null

/** Момент, внутри которого находится время; при пересечении — начавшийся позже. */
export function momentAt(moments: Moment[], time: number, tolerance = 0): Moment | null {
  let found: Moment | null = null
  for (const m of moments) {
    if (time >= m.start - tolerance && time <= m.end + tolerance && (!found || m.start >= found.start)) found = m
  }
  return found
}

export function collectTags(moments: Moment[]): string[] {
  return [...new Set(moments.flatMap((m) => m.tags ?? []))].sort((a, b) => a.localeCompare(b, 'ru'))
}

export function parseTags(input: string): string[] {
  return [...new Set(input.split(',').map((t) => t.trim()).filter(Boolean))]
}
