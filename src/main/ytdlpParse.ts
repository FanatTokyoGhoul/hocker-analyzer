/** Разбор вывода yt-dlp и подсчёт общего прогресса — без Electron и процессов, чтобы проверять тестами. */

/**
 * Предпочитаем H.264 + AAC (Chromium играет без конвертации) не выше 1080p; если такого нет —
 * готовый mp4, дальше что угодно (тогда приложение предложит конвертацию).
 */
export const FORMAT_SELECTOR =
  'bv*[vcodec^=avc1][height<=1080]+ba[acodec^=mp4a]/bv*[vcodec^=avc1][height<=1080]+ba/b[ext=mp4][height<=1080]/bv*[height<=1080]+ba/b'

/** Метка строк прогресса: остальной вывод yt-dlp пропускаем. */
export const PROGRESS_MARK = '[ha-progress]'
export const PROGRESS_TEMPLATE =
  `download:${PROGRESS_MARK} %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s ` +
  '%(progress.speed)s %(progress.eta)s %(info.vcodec)s %(info.format_id)s'

/** Имя готовой сборки yt-dlp в релизах на GitHub; null — платформа не поддерживается. */
export function ytDlpAsset(platform: string, arch: string): string | null {
  if (platform === 'win32') return 'yt-dlp.exe'
  if (platform === 'darwin') return 'yt-dlp_macos'
  if (platform === 'linux') return arch === 'arm64' ? 'yt-dlp_linux_aarch64' : arch === 'x64' ? 'yt-dlp_linux' : null
  return null
}

/** SHA-256 файла из списка SHA2-256SUMS («<hex>  <имя>» по строке). */
export function checksumFor(sums: string, asset: string): string | null {
  for (const line of sums.split(/\r?\n/)) {
    const m = /^([a-f\d]{64})\s+\*?(.+)$/i.exec(line.trim())
    if (m && m[2] === asset) return m[1].toLowerCase()
  }
  return null
}

export type ProgressLine = {
  downloaded: number
  total: number | null
  speed: number | null
  eta: number | null
  audio: boolean
  formatId: string
}

const num = (v: string | undefined): number | null => {
  const n = Number(v)
  return v && v !== 'NA' && Number.isFinite(n) && n >= 0 ? n : null
}

export function parseProgressLine(line: string): ProgressLine | null {
  const i = line.indexOf(PROGRESS_MARK)
  if (i < 0) return null
  const [downloaded, total, estimate, speed, eta, vcodec, formatId] = line.slice(i + PROGRESS_MARK.length).trim().split(/\s+/)
  const done = num(downloaded)
  if (done === null || !formatId) return null
  return { downloaded: done, total: num(total) ?? num(estimate), speed: num(speed), eta: num(eta), audio: vcodec === 'none', formatId }
}

/** Склейка/исправление после скачивания — строки вида «[Merger] Merging formats into …». */
export const isPostprocessLine = (line: string): boolean => /^\[(Merger|FixupM3u8|FixupM4a|FixupDuplicateMoov|VideoConvertor)\]/.test(line.trim())

/** Последняя строка ошибки yt-dlp, понятная человеку. */
export function errorFromStderr(stderr: string): string {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const error = [...lines].reverse().find((l) => l.startsWith('ERROR:'))
  const text = (error ?? lines[lines.length - 1] ?? '').replace(/^ERROR:\s*/, '')
  if (/registered users|log ?in|private|access (is )?denied|только для|недоступ/i.test(text)) {
    return 'Видео недоступно без входа в VK: оно приватное или только для участников сообщества'
  }
  if (/unsupported url/i.test(text)) return 'По этой ссылке нет видео'
  if (/unable to download|timed out|connection|getaddrinfo|network/i.test(text)) return `Нет связи с VK: ${text}`
  return text || 'yt-dlp завершился с ошибкой'
}

export type PlannedFormat = { formatId: string; size: number | null; audio: boolean }

type InfoFormat = { format_id?: unknown; filesize?: unknown; filesize_approx?: unknown; tbr?: unknown; vcodec?: unknown }

/**
 * Какие потоки скачает yt-dlp (видео и звук отдельно или один файл) и их размеры.
 * VK часто не сообщает размер — тогда оцениваем по битрейту и длительности; точный размер
 * заменит оценку, как только поток начнёт скачиваться.
 */
export function plannedFormats(info: { requested_formats?: InfoFormat[]; duration?: unknown } & InfoFormat): PlannedFormat[] {
  const list = Array.isArray(info.requested_formats) && info.requested_formats.length ? info.requested_formats : [info]
  const duration = num(String(info.duration ?? ''))
  return list.map((f) => {
    const tbr = num(String(f.tbr ?? ''))
    const estimate = tbr && duration ? Math.round((tbr * 1000 * duration) / 8) : null
    return {
      formatId: String(f.format_id ?? ''),
      size: num(String(f.filesize ?? '')) ?? num(String(f.filesize_approx ?? '')) ?? estimate,
      audio: f.vcodec === 'none'
    }
  })
}

/**
 * Общий прогресс по всем потокам: готовые потоки целиком + текущий. Размер потока, который
 * сайт не сообщил заранее, берётся из строк прогресса, как только он появляется.
 */
export class ProgressTracker {
  private sizes = new Map<string, number | null>()
  private done = new Set<string>()
  private current: ProgressLine | null = null
  /** Полоса не откатывается назад, когда оценку размера сменил точный. */
  private best = 0

  constructor(plan: PlannedFormat[]) {
    for (const f of plan) this.sizes.set(f.formatId, f.size)
  }

  update(line: ProgressLine): { downloaded: number; total: number | null; ratio: number | null } {
    if (this.current && this.current.formatId !== line.formatId) this.done.add(this.current.formatId)
    if (!this.sizes.has(line.formatId)) this.sizes.set(line.formatId, null)
    if (line.total !== null) this.sizes.set(line.formatId, line.total)
    this.current = line
    let downloaded = line.downloaded
    for (const id of this.done) downloaded += this.sizes.get(id) ?? 0
    const sizes = [...this.sizes.values()]
    const total = sizes.every((s) => s !== null) ? sizes.reduce<number>((a, s) => a + (s ?? 0), 0) : null
    if (!total) return { downloaded, total, ratio: null }
    this.best = Math.max(this.best, Math.min(1, downloaded / total))
    return { downloaded, total, ratio: this.best }
  }
}
