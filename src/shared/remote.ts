import type { Shape } from './types'
import { parseShape } from './project'
import { normalizeHex } from './settings'

/**
 * Пульт с телефона: десктоп поднимает HTTP-сервер в локальной сети, телефон открывает страницу по QR-коду.
 * Телефон шлёт команды (POST /api/command), десктоп присылает состояние (SSE /api/events).
 * Десктоп — единственный источник истины: команды выполняются теми же функциями, что и горячие клавиши.
 */

export type RemoteMoment = {
  id: string
  title: string
  /** Время проекта, секунды. */
  start: number
  end: number
  tags: string[]
  notes?: string
  shapes: number
}

export type RemoteState = {
  /** Открыт ли проект с видео. */
  ready: boolean
  title: string
  /** Время активного видео, секунды. */
  time: number
  duration: number
  paused: boolean
  rate: number
  fps: number
  frame: number
  /** Меняется, когда меняется показанный кадр или видео, — по нему телефон перезапрашивает снимок. */
  frameKey: string
  /** Соотношение сторон кадра (ширина / высота). */
  aspect: number
  videoId: string | null
  videos: { id: string; label: string }[]
  moments: RemoteMoment[]
  activeMomentId: string | null
  playlist: { index: number; total: number } | null
  /** Остановка на рисунке: ждёт продолжения. */
  hold: boolean
  draft: { start: number | null; end: number | null }
  quickTags: { label: string }[]
  /** Можно ли рисовать на текущем кадре; если нет — почему. */
  canDraw: boolean
  drawHint: string | null
  /** Фигуры на текущем кадре (координаты 0..1). */
  shapes: Shape[]
  color: string
  colors: string[]
  stepMs: number
  /** Почему пульт сейчас не управляет (открыто окно на компьютере, идёт конвертация). */
  notice: string | null
}

export type RemoteCommand =
  | { type: 'togglePlay' }
  | { type: 'continue' }
  | { type: 'stepFrame'; delta: -1 | 1 }
  | { type: 'stepMs'; sign: -1 | 1 }
  | { type: 'setRate'; rate: number }
  | { type: 'selectVideo'; id: string }
  | { type: 'selectMoment'; id: string }
  | { type: 'playMoment'; id: string }
  | { type: 'playAll' }
  | { type: 'stopPlaylist' }
  | { type: 'markIn' }
  | { type: 'markOut' }
  | { type: 'addMoment'; title: string; tags: string[] }
  | { type: 'quickTag'; index: number }
  /** Начали рисовать: остановка на рисунке по таймеру замирает, как при рисовании мышью. */
  | { type: 'drawStart' }
  /** frameKey — кадр, который видел телефон: если компьютер уже на другом кадре, команда отклоняется. */
  | { type: 'addShape'; shape: Shape; frameKey: string }
  | { type: 'undoShape'; frameKey: string }
  | { type: 'clearShapes'; frameKey: string }
  | { type: 'undo' }
  | { type: 'redo' }

const SIMPLE = new Set(['togglePlay', 'continue', 'playAll', 'stopPlaylist', 'markIn', 'markOut', 'drawStart', 'undo', 'redo'])
const MAX_TEXT = 200
const MAX_TAGS = 20
const isStr = (v: unknown, max = MAX_TEXT): v is string => typeof v === 'string' && v.length <= max
const isId = (v: unknown): v is string => isStr(v, 100) && v.length > 0
const sign = (v: unknown): -1 | 1 | null => (v === -1 || v === 1 ? v : null)
/** Ключ кадра, по которому рисует телефон (обязателен для команд рисования). */
const frameKeyOf = (v: unknown): { frameKey: string } | null => (isStr(v, 140) && v ? { frameKey: v } : null)

/** Команда от телефона — недоверенный ввод: пропускаем только известные команды с корректными полями. */
export function parseRemoteCommand(raw: unknown): RemoteCommand | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const type = r.type
  if (typeof type !== 'string') return null
  if (SIMPLE.has(type)) return { type } as RemoteCommand
  switch (type) {
    case 'stepFrame': {
      const d = sign(r.delta)
      return d && { type, delta: d }
    }
    case 'stepMs': {
      const s = sign(r.sign)
      return s && { type, sign: s }
    }
    case 'setRate':
      return typeof r.rate === 'number' && Number.isFinite(r.rate) ? { type, rate: r.rate } : null
    case 'selectVideo':
    case 'selectMoment':
    case 'playMoment':
      return isId(r.id) ? { type, id: r.id } : null
    case 'addMoment': {
      if (!isStr(r.title) || !Array.isArray(r.tags) || r.tags.length > MAX_TAGS || !r.tags.every((t) => isStr(t, 40))) return null
      return { type, title: r.title, tags: r.tags as string[] }
    }
    case 'quickTag':
      return Number.isInteger(r.index) && (r.index as number) >= 0 && (r.index as number) < 9 ? { type, index: r.index as number } : null
    case 'undoShape':
    case 'clearShapes': {
      const key = frameKeyOf(r.frameKey)
      return key && { type, ...key }
    }
    case 'addShape': {
      const key = frameKeyOf(r.frameKey)
      const shape = parseShape(r.shape)
      if (!key || !shape || !isId(shape.id)) return null
      const color = normalizeHex(shape.color)
      if (!color) return null
      // координаты фигуры — доли кадра; заметно за кадром рисовать нечего
      const coords = 'points' in shape ? shape.points : [shape.x, shape.y]
      if (coords.length > 4000 || !coords.every((c) => c >= -0.5 && c <= 1.5)) return null
      if ((shape.kind === 'circle' || shape.kind === 'spotlight') && !(shape.rx > 0 && shape.rx <= 2 && shape.ry > 0 && shape.ry <= 2)) return null
      return { type, shape: { ...shape, color }, ...key }
    }
    default:
      return null
  }
}
