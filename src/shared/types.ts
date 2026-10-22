import type { Settings } from './settings'
import type { RemoteCommand, RemoteState } from './remote'
import type { DownloadProgress } from './vk'

/** Координаты фигур нормированы к кадру (0..1), чтобы не зависеть от размера окна. */
export type ShapeKind = 'arrow' | 'line' | 'circle' | 'freehand' | 'zone' | 'spotlight' | 'text'

export type LineShape = {
  id: string
  kind: 'arrow' | 'line'
  points: [number, number, number, number]
  color: string
  /** Пунктир — обычно пас, сплошная — движение игрока. */
  dashed?: boolean
}

export type CircleShape = {
  id: string
  kind: 'circle'
  x: number
  y: number
  rx: number
  ry: number
  color: string
}

/** Подсветка игрока: всё вокруг эллипса затемняется. */
export type SpotlightShape = Omit<CircleShape, 'kind'> & { kind: 'spotlight' }

export type FreehandShape = {
  id: string
  kind: 'freehand'
  points: number[]
  color: string
}

/** Закрашенная зона — замкнутый многоугольник (x1, y1, x2, y2, …), не меньше трёх вершин. */
export type ZoneShape = {
  id: string
  kind: 'zone'
  points: number[]
  color: string
}

/** Подпись: x, y — левый верхний угол. */
export type TextShape = {
  id: string
  kind: 'text'
  x: number
  y: number
  text: string
  color: string
}

export type Shape = LineShape | CircleShape | SpotlightShape | FreehandShape | ZoneShape | TextShape

/** time — время проекта (середина кадра); videoId — на каком видео нарисовано (нет — на первом). */
export type Drawing = { time: number; shapes: Shape[]; videoId?: string }

export type Moment = {
  id: string
  title: string
  start: number // секунды, время проекта
  end: number
  tags?: string[]
  drawings?: Drawing[]
  notes?: string
  /** Тактическая схема на площадке; координаты нормированы к площадке 200×85. */
  board?: Shape[]
}

/**
 * Видео проекта. Время моментов — общее время проекта: локальное время видео = время проекта − offset.
 * Периоды подряд — offset = конец предыдущего; другая камера — offset подбирается синхронизацией.
 */
export type ProjectVideo = {
  id: string
  path: string
  label: string
  offset: number
  fps: number
  /** Длительность, с — запоминается при открытии, чтобы знать, какое видео покрывает время проекта. */
  duration?: number
}

/** Тактическая схема, не привязанная к моменту; координаты нормированы к площадке, как у Moment.board. */
export type Board = {
  id: string
  title: string
  shapes: Shape[]
}

export type Project = {
  version?: number
  /** Путь первого видео — для совместимости с проектами v1. */
  videoPath: string
  fps: number
  videos: ProjectVideo[]
  moments: Moment[]
  /** Время проекта, с которого начинаются 2-й, 3-й … периоды. */
  periods?: number[]
  /** Свободные схемы площадки (кнопка 📋 над видео). */
  boards?: Board[]
}

export type VideoInfo = {
  path: string
  url: string
  fps: number
  duration: number
  width: number
  height: number
  videoCodec: string
  audioCodec: string | null
  /** Chromium не сможет воспроизвести файл без перекодирования. */
  needsConversion: boolean
  conversionReason: string | null
  /** Переменная частота кадров: шаг 1/fps неточен, стоит перекодировать в постоянную. */
  variableFrameRate: boolean
}

export type ConvertProgress = { ratio: number; outTime: number }

export type OpenedProject = {
  path: string
  project: Project
  /** id видео, не найденных ни по сохранённому пути, ни рядом с файлом проекта. */
  missingVideos: string[]
}

/** Черновик несохранённой работы (profile/recovery.json). */
export type Recovery = {
  savedAt: number
  projectPath: string | null
  project: Project
  missingVideos: string[]
}

/** Рисунок для экспорта: стоп-кадр в момент time (локальное время видео) с наложенной картинкой. */
export type ExportOverlay = { time: number; png: string }

export type ExportClip = {
  title: string
  videoPath: string
  /** Локальное время видео, секунды. */
  start: number
  end: number
  /** Размер кадра исходного видео: картинки рисунков нарисованы в этом размере. */
  width: number
  height: number
  fps: number
  overlays: ExportOverlay[]
  /** Подпись (название, теги) размером с выходной кадр — показывается первые секунды клипа. */
  captionPng?: string
  /** Схема площадки размером с выходной кадр — показывается перед клипом. */
  boardPng?: string
}

export type ExportRequest = {
  clips: ExportClip[]
  /** single — один файл-подборка, separate — по файлу на клип в выбранную папку. */
  mode: 'single' | 'separate'
  /** Сколько секунд стоит стоп-кадр рисунка и схема площадки. */
  holdSeconds: number
  /** Выходной кадр и частота. */
  width: number
  height: number
  fps: number
  /** Имя файла по умолчанию (без расширения). */
  suggestedName: string
}

export type ExportProgress = { ratio: number; clip: number; clips: number }

export type ExportResult = { paths: string[] }

export type LoadedSettings = { settings: Settings; path: string }

/** Адрес пульта: телефон открывает url (он же в QR-коде). */
export type RemoteAddress = { ip: string; url: string; qrSvg: string }

export type RemoteInfo = {
  running: boolean
  addresses: RemoteAddress[]
  /** Сколько телефонов сейчас подключено. */
  clients: number
  /** Адрес устройства, к которому привязан пульт (первое открывшее страницу). */
  device: string | null
}

/** Состояние для пульта + откуда main снимает кадр для рисования на телефоне. */
export type RemotePublish = {
  state: RemoteState
  /** Видео и локальное время текущего кадра (середина кадра) — для снимка. */
  frame: { videoPath: string; time: number } | null
}

export interface HockeyApi {
  openVideoDialog(): Promise<VideoInfo | null>
  probeVideo(path: string): Promise<VideoInfo>
  registerDroppedFile(file: File): Promise<VideoInfo>
  convertVideo(path: string): Promise<VideoInfo>
  cancelConvert(): Promise<void>
  onConvertProgress(cb: (p: ConvertProgress) => void): () => void
  /** Скачать видео VK по ссылке в «Видео/Hockey Analyzer» и открыть его. */
  downloadVk(url: string): Promise<VideoInfo>
  cancelVkDownload(): Promise<void>
  onVkProgress(cb: (p: DownloadProgress) => void): () => void
  /** Добавить видео в проект (то же, что открыть, но без нового проекта). */
  addVideoDialog(): Promise<VideoInfo | null>
  openProjectDialog(): Promise<OpenedProject | null>
  saveProject(path: string | null, project: Project): Promise<string | null>
  confirm(message: string, detail?: string): Promise<boolean>
  setDirty(dirty: boolean): void
  setTitle(title: string): void
  /** Синхронно читает settings.json (вызывается один раз при запуске). */
  loadSettings(): LoadedSettings
  saveSettings(settings: Settings): void
  revealSettings(): Promise<void>
  /** Черновик для восстановления после сбоя; null — убрать. */
  writeRecovery(recovery: Omit<Recovery, 'missingVideos'> | null): void
  readRecovery(): Promise<Recovery | null>
  /** Экспорт клипов: сам спрашивает файл/папку; null — пользователь отменил. */
  exportClips(request: ExportRequest): Promise<ExportResult | null>
  cancelExport(): Promise<void>
  onExportProgress(cb: (p: ExportProgress) => void): () => void
  /** Сохранить текст (CSV) через диалог; возвращает путь или null. */
  saveTextFile(suggestedName: string, content: string, ext: string): Promise<string | null>
  revealFile(path: string): Promise<void>
  /** Пульт с телефона: запустить/остановить сервер в локальной сети. */
  startRemote(): Promise<RemoteInfo>
  stopRemote(): Promise<void>
  publishRemoteState(payload: RemotePublish): void
  onRemoteCommand(cb: (cmd: RemoteCommand) => void): () => void
  onRemoteStatus(cb: (info: RemoteInfo) => void): () => void
}
