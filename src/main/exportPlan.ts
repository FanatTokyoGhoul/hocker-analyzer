/** Чистые функции сборки команд ffmpeg для экспорта клипов — без Electron и файловой системы, покрыты тестами. */
import type { ExportClip } from '../shared/types'
import { INPUT_WHITELIST } from './probe'

export type ExportParams = { width: number; height: number; fps: number; holdSeconds: number }

/** Кусок готового клипа: обычное воспроизведение или стоп-кадр рисунка. */
export type Piece =
  | { kind: 'play'; from: number; /** null — до конца клипа */ to: number | null }
  | { kind: 'freeze'; at: number; /** индекс в clip.overlays */ overlay: number }

export const CAPTION_SECONDS = 3
const SAMPLE_RATE = 48000

/** Секунды в короткую строку для фильтров (без экспоненты и хвоста нулей). */
const num = (x: number): string => String(Number(x.toFixed(6)))

/**
 * Режет клип на куски. Все времена — от начала клипа (после `-ss start`).
 * Стоп-кадр берётся окном в один кадр, центрированным на моменте рисунка: так выбирается ближайший кадр
 * независимо от того, как исходный файл выровнен по сетке кадров. Рисунки вне клипа игнорируются.
 */
export function planPieces(clip: ExportClip, holdSeconds: number): Piece[] {
  const dur = clip.end - clip.start
  const frame = 1 / clip.fps
  const cuts =
    holdSeconds > 0
      ? clip.overlays
          .map((o, overlay) => ({ overlay, t: o.time - clip.start }))
          .filter((c) => c.t >= -frame / 2 && c.t <= dur + frame / 2)
          .sort((a, b) => a.t - b.t)
      : []

  const pieces: Piece[] = []
  let pos = 0
  for (const c of cuts) {
    const at = Math.min(Math.max(c.t - frame / 2, 0), dur)
    if (at - pos > frame / 2) pieces.push({ kind: 'play', from: pos, to: at })
    pieces.push({ kind: 'freeze', at, overlay: c.overlay })
    pos = Math.max(pos, at)
  }
  pieces.push({ kind: 'play', from: pos, to: null })
  return pieces
}

/** Длительность готового клипа: сам отрезок + стоп-кадры + схема площадки. */
export function expectedClipDuration(clip: ExportClip, holdSeconds: number): number {
  const freezes = planPieces(clip, holdSeconds).filter((p) => p.kind === 'freeze').length
  const board = clip.boardPng && holdSeconds > 0 ? holdSeconds : 0
  return clip.end - clip.start + freezes * holdSeconds + board
}

export type ClipJobOptions = {
  clip: ExportClip
  params: ExportParams
  hasAudio: boolean
  /** Путь PNG-файла для каждого рисунка клипа (по индексу clip.overlays). */
  overlayPaths: string[]
  captionPath?: string
  boardPath?: string
  /** Файл, куда runner запишет текст фильтра. */
  scriptPath: string
  outputPath: string
}

export type ClipJob = { args: string[]; filterScript: string; duration: number }

/** Фильтр-граф и аргументы ffmpeg для одного клипа — один запуск на клип. */
export function buildClipJob(o: ClipJobOptions): ClipJob {
  const { clip, params, hasAudio } = o
  const { width: W, height: H, fps: F, holdSeconds: hold } = params
  const dur = clip.end - clip.start
  const pieces = planPieces(clip, hold)
  const board = o.boardPath && hold > 0 ? o.boardPath : undefined
  const caption = o.captionPath

  // входы: 0 — видео, дальше PNG
  const pngInputs: string[] = []
  const addPng = (p: string): number => pngInputs.push(p)

  const norm = `scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${num(F)},format=yuv420p`
  const holdPad = `tpad=stop_mode=clone:stop_duration=${num(Math.max(0, hold - 1 / F))}`
  const audioFmt = `aformat=sample_fmts=fltp:channel_layouts=stereo`
  const silence = (d: number): string => `aevalsrc=0:c=stereo:s=${SAMPLE_RATE}:d=${num(d)},${audioFmt}`

  const nPlay = pieces.filter((p) => p.kind === 'play' || p.kind === 'freeze').length
  const lines: string[] = []
  lines.push(
    nPlay === 1
      ? '[0:v]null[src0]'
      : `[0:v]split=${nPlay}${pieces.map((_, i) => `[src${i}]`).join('')}`
  )
  const nPlayOnly = pieces.filter((p) => p.kind === 'play').length
  if (hasAudio) {
    const base = `aresample=osr=${SAMPLE_RATE}:ochl=stereo,${audioFmt}`
    lines.push(
      nPlayOnly === 1
        ? `[0:a]${base}[asrc0]`
        : `[0:a]${base},asplit=${nPlayOnly}${Array.from({ length: nPlayOnly }, (_, i) => `[asrc${i}]`).join('')}`
    )
  }

  const seq: string[] = [] // метки "[vN][aN]" в порядке показа
  let k = 0
  let a = 0
  if (board) {
    const idx = addPng(board)
    lines.push(`[${idx}:v]${norm},${holdPad}[vb]`, `${silence(hold)}[ab]`)
    seq.push('[vb][ab]')
  }
  pieces.forEach((p, i) => {
    if (p.kind === 'play') {
      const range = p.to === null ? `start=${num(p.from)}` : `start=${num(p.from)}:end=${num(p.to)}`
      const d = (p.to ?? dur) - p.from
      lines.push(`[src${i}]trim=${range},setpts=PTS-STARTPTS,${norm}[v${k}]`)
      lines.push(
        hasAudio
          ? `[asrc${a++}]atrim=${range},asetpts=PTS-STARTPTS[a${k}]`
          : `${silence(Math.max(d, 1 / F))}[a${k}]`
      )
    } else {
      const idx = addPng(o.overlayPaths[p.overlay])
      lines.push(
        // растягиваем кадр до hold ДО наложения: overlay на единственном кадре с последующими фильтрами кадров не отдаёт
        `[src${i}]trim=start=${num(p.at)}:end=${num(p.at + 1 / clip.fps)},setpts=PTS-STARTPTS,fps=${num(F)},${holdPad}[f${k}]`,
        `[f${k}][${idx}:v]overlay=format=auto:repeatlast=1:shortest=0[o${k}]`,
        `[o${k}]${norm}[v${k}]`,
        `${silence(hold)}[a${k}]`
      )
    }
    seq.push(`[v${k}][a${k}]`)
    k++
  })

  const concatOut = caption ? '[vc]' : '[vout]'
  lines.push(`${seq.join('')}concat=n=${seq.length}:v=1:a=1${concatOut}[aout]`)
  if (caption) {
    const idx = addPng(caption)
    const from = board ? hold : 0
    lines.push(`[vc][${idx}:v]overlay=format=auto:enable='between(t,${num(from)},${num(from + CAPTION_SECONDS)})',format=yuv420p[vout]`)
  }

  const args = [
    '-y',
    '-ss', num(clip.start),
    '-t', num(dur),
    ...INPUT_WHITELIST,
    '-i', clip.videoPath,
    ...pngInputs.flatMap((p) => ['-protocol_whitelist', 'file', '-f', 'image2', '-i', p]),
    '-filter_complex_script', o.scriptPath,
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-ar', String(SAMPLE_RATE),
    '-ac', '2',
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    '-nostats',
    o.outputPath
  ]
  return { args, filterScript: lines.join(';\n') + '\n', duration: expectedClipDuration(clip, hold) }
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Название клипа → безопасная часть имени файла для Windows и Linux. */
export function sanitizeFileName(title: string, maxLength = 80): string {
  let s = title
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .replace(/[. ]+$/, '')
  if (!s) s = 'Клип'
  if (RESERVED.test(s.split('.')[0])) s = `_${s}`
  return s
}

/** `NN Название.mp4`; NN — порядковый номер с 1. */
export function clipFileName(index: number, total: number, title: string): string {
  const width = Math.max(2, String(total).length)
  return `${String(index + 1).padStart(width, '0')} ${sanitizeFileName(title)}.mp4`
}

/** Список для concat-демультиплексора: пути в одинарных кавычках, `'` → `'\''`. */
export function buildConcatList(paths: string[]): string {
  return paths.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n'
}

export function buildConcatArgs(listPath: string, outputPath: string): string[] {
  return [
    '-y',
    '-protocol_whitelist', 'file,concat',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    '-nostats',
    outputPath
  ]
}
