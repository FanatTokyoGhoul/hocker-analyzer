import type { Board, Drawing, Moment, Project, ProjectVideo, Shape } from './types'

export const PROJECT_VERSION = 2
export const MAX_TEXT_LENGTH = 200

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isPoints = (v: unknown, min: number): v is number[] => Array.isArray(v) && v.length >= min && v.length % 2 === 0 && v.every(isNum)

export function parseShape(raw: unknown): Shape | null {
  if (!isObj(raw) || !isStr(raw.id) || !isStr(raw.color)) return null
  const { id, color } = raw
  switch (raw.kind) {
    case 'arrow':
    case 'line':
      if (Array.isArray(raw.points) && raw.points.length === 4 && raw.points.every(isNum)) {
        const shape: Shape = { id, color, kind: raw.kind, points: raw.points as [number, number, number, number] }
        if (raw.dashed === true) shape.dashed = true
        return shape
      }
      return null
    case 'circle':
    case 'spotlight':
      if ([raw.x, raw.y, raw.rx, raw.ry].every(isNum)) {
        return { id, color, kind: raw.kind, x: raw.x as number, y: raw.y as number, rx: raw.rx as number, ry: raw.ry as number }
      }
      return null
    case 'freehand':
      return isPoints(raw.points, 4) ? { id, color, kind: 'freehand', points: raw.points } : null
    case 'zone':
      return isPoints(raw.points, 6) ? { id, color, kind: 'zone', points: raw.points } : null
    case 'text':
      if (isNum(raw.x) && isNum(raw.y) && isStr(raw.text) && raw.text.trim()) {
        return { id, color, kind: 'text', x: raw.x, y: raw.y, text: raw.text.trim().slice(0, MAX_TEXT_LENGTH) }
      }
      return null
    default:
      return null
  }
}

export const parseShapes = (raw: unknown): Shape[] =>
  Array.isArray(raw) ? raw.map(parseShape).filter((s): s is Shape => s !== null) : []

function parseDrawing(raw: unknown, videoIds: Set<string>): Drawing | null {
  if (!isObj(raw) || !isNum(raw.time)) return null
  const shapes = parseShapes(raw.shapes)
  if (!shapes.length) return null
  const drawing: Drawing = { time: raw.time, shapes }
  // рисунок на удалённом видео не показать — он «переезжает» на первое
  if (isStr(raw.videoId) && videoIds.has(raw.videoId)) drawing.videoId = raw.videoId
  return drawing
}

function parseMoment(raw: unknown, index: number, videoIds: Set<string>): Moment {
  if (!isObj(raw)) throw new Error(`Момент #${index + 1}: ожидается объект`)
  if (!isNum(raw.start) || !isNum(raw.end)) throw new Error(`Момент #${index + 1}: нет start/end`)
  const start = Math.max(0, Math.min(raw.start, raw.end))
  const end = Math.max(raw.start, raw.end)
  const moment: Moment = {
    id: isStr(raw.id) && raw.id ? raw.id : `m-${index}-${Date.now().toString(36)}`,
    title: isStr(raw.title) ? raw.title : `Момент ${index + 1}`,
    start,
    end
  }
  if (Array.isArray(raw.tags)) moment.tags = raw.tags.filter(isStr)
  if (Array.isArray(raw.drawings)) {
    moment.drawings = raw.drawings.map((d) => parseDrawing(d, videoIds)).filter((d): d is Drawing => d !== null)
  }
  if (isStr(raw.notes) && raw.notes.trim()) moment.notes = raw.notes
  const board = parseShapes(raw.board)
  if (board.length) moment.board = board
  return moment
}

function parseVideos(raw: Record<string, unknown>): ProjectVideo[] {
  const fallbackFps = isNum(raw.fps) && raw.fps > 0 ? raw.fps : 30
  const seen = new Set<string>()
  const videos: ProjectVideo[] = []
  if (Array.isArray(raw.videos)) {
    raw.videos.forEach((v, i) => {
      if (!isObj(v) || !isStr(v.path) || !v.path) return
      let id = isStr(v.id) && v.id ? v.id : `v${i + 1}`
      while (seen.has(id)) id += '_'
      seen.add(id)
      videos.push({
        id,
        path: v.path,
        label: isStr(v.label) && v.label.trim() ? v.label : `Видео ${videos.length + 1}`,
        offset: isNum(v.offset) ? v.offset : 0,
        fps: isNum(v.fps) && v.fps > 0 ? v.fps : fallbackFps,
        ...(isNum(v.duration) && v.duration > 0 ? { duration: v.duration } : {})
      })
    })
  }
  // проект v1 — одно видео в videoPath
  if (!videos.length) {
    if (!isStr(raw.videoPath)) throw new Error('В проекте нет videoPath')
    videos.push({ id: 'v1', path: raw.videoPath, label: 'Видео 1', offset: 0, fps: fallbackFps })
  }
  return videos
}

export function normalizePeriodStarts(periods: unknown): number[] {
  if (!Array.isArray(periods)) return []
  return [...new Set(periods.filter((p): p is number => isNum(p) && p > 0))].sort((a, b) => a - b)
}

export const MAX_BOARD_TITLE = 80
/** Больше схем в проекте не бывает; чужой файл с тысячами схем не должен вешать открытие. */
const MAX_BOARDS = 500

/** Свободные схемы: битые отбрасываются, повторы id получают суффикс; пустая схема — тоже схема. */
export function parseBoards(raw: unknown): Board[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const boards: Board[] = []
  raw.slice(0, MAX_BOARDS).forEach((b, i) => {
    if (!isObj(b)) return
    let id = isStr(b.id) && b.id ? b.id.slice(0, 64) : `b${i + 1}`
    if (seen.has(id)) id = `${id}_${i}`
    seen.add(id)
    const title = isStr(b.title) && b.title.trim() ? b.title.trim().slice(0, MAX_BOARD_TITLE) : `Схема ${boards.length + 1}`
    boards.push({ id, title, shapes: parseShapes(b.shapes) })
  })
  return boards
}

/** Проверяет JSON проекта, отбрасывая битые фигуры; на критичных ошибках бросает исключение. */
export function parseProject(raw: unknown): Project {
  if (!isObj(raw)) throw new Error('Файл проекта должен содержать JSON-объект')
  if (!Array.isArray(raw.moments)) throw new Error('В проекте нет списка moments')
  const videos = parseVideos(raw)
  const ids = new Set(videos.map((v) => v.id))
  const project: Project = {
    version: PROJECT_VERSION,
    videoPath: videos[0].path,
    fps: videos[0].fps,
    videos,
    moments: raw.moments.map((m, i) => parseMoment(m, i, ids))
  }
  const periods = normalizePeriodStarts(raw.periods)
  if (periods.length) project.periods = periods
  const boards = parseBoards(raw.boards)
  if (boards.length) project.boards = boards
  return project
}

export function serializeProject(project: Project): string {
  const first = project.videos[0]
  // videoPath/fps дублируют первое видео — их читают версии v1
  return JSON.stringify({ ...project, version: PROJECT_VERSION, videoPath: first?.path ?? project.videoPath, fps: first?.fps ?? project.fps }, null, 2) + '\n'
}
