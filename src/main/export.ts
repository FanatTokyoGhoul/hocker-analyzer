import { spawn, type ChildProcess } from 'child_process'
import { lstatSync } from 'fs'
import { copyFile, mkdtemp, rename, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, parse } from 'path'
import type { ExportProgress, ExportRequest } from '../shared/types'
import { FFMPEG, probe } from './ffmpeg'
import { buildClipJob, buildConcatArgs, buildConcatList, clipFileName, expectedClipDuration } from './exportPlan'
import { parseProgressTime } from './probe'

const PNG_PREFIX = 'data:image/png;base64,'
const MAX_PNG_CHARS = 25 * 1024 * 1024
const MAX_CLIPS = 500
const MAX_OVERLAYS = 2000
/** Все картинки запроса вместе — чтобы один запрос не забил память и временную папку. */
const MAX_TOTAL_PNG_CHARS = 500 * 1024 * 1024
/** Предел длительности всего экспорта: защита от «бесконечного» клипа из подложенного проекта. */
const MAX_TOTAL_SECONDS = 6 * 3600

const CANCELLED = 'Экспорт отменён'

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const inRange = (x: unknown, min: number, max: number): x is number => isNum(x) && x >= min && x <= max

function checkPng(value: unknown, what: string): void {
  if (typeof value !== 'string' || !value.startsWith(PNG_PREFIX) || value.length > MAX_PNG_CHARS) {
    throw new Error(`Некорректная картинка: ${what}`)
  }
}

/** Запрос приходит из рендерера — проверяем всё, что попадёт в ffmpeg и на диск. */
export function validateExportRequest(r: unknown): ExportRequest {
  const req = r as ExportRequest
  if (!req || typeof req !== 'object') throw new Error('Некорректный запрос экспорта')
  if (req.mode !== 'single' && req.mode !== 'separate') throw new Error('Некорректный режим экспорта')
  if (!inRange(req.width, 16, 8192) || !inRange(req.height, 16, 8192)) throw new Error('Некорректный размер кадра')
  if (!inRange(req.fps, 1, 240)) throw new Error('Некорректная частота кадров')
  if (!inRange(req.holdSeconds, 0, 60)) throw new Error('Некорректная длительность стоп-кадра')
  if (typeof req.suggestedName !== 'string') throw new Error('Некорректное имя файла')
  if (!Array.isArray(req.clips) || req.clips.length === 0) throw new Error('Нет клипов для экспорта')
  if (req.clips.length > MAX_CLIPS) throw new Error(`Слишком много клипов (максимум ${MAX_CLIPS})`)

  let overlays = 0
  let pngChars = 0
  const addPng = (v: string | undefined): void => {
    pngChars += v?.length ?? 0
    if (pngChars > MAX_TOTAL_PNG_CHARS) throw new Error('Слишком большой объём рисунков для экспорта')
  }
  for (const c of req.clips) {
    if (!c || typeof c !== 'object') throw new Error('Некорректный клип')
    if (typeof c.title !== 'string' || typeof c.videoPath !== 'string' || !c.videoPath) throw new Error('Некорректный клип')
    if (!isNum(c.start) || !isNum(c.end) || c.start < 0 || c.end <= c.start) throw new Error('Некорректные границы клипа')
    if (!inRange(c.width, 16, 8192) || !inRange(c.height, 16, 8192) || !inRange(c.fps, 1, 240)) {
      throw new Error('Некорректные параметры видео клипа')
    }
    if (!Array.isArray(c.overlays)) throw new Error('Некорректные рисунки клипа')
    overlays += c.overlays.length
    if (overlays > MAX_OVERLAYS) throw new Error(`Слишком много рисунков (максимум ${MAX_OVERLAYS})`)
    for (const o of c.overlays) {
      if (!o || !isNum(o.time)) throw new Error('Некорректный рисунок')
      checkPng(o.png, 'рисунок')
      addPng(o.png)
    }
    if (c.captionPng !== undefined) checkPng(c.captionPng, 'подпись')
    if (c.boardPng !== undefined) checkPng(c.boardPng, 'схема площадки')
    addPng(c.captionPng)
    addPng(c.boardPng)
  }
  return req
}

let current: ChildProcess | null = null
let running = false
let cancelled = false

export function cancelExport(): void {
  cancelled = true
  current?.kill('SIGKILL')
}

function runFfmpeg(args: string[], onTime: (t: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    if (cancelled) return reject(new Error(CANCELLED))
    const child = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    current = child
    let stderrTail = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      const t = parseProgressTime(chunk)
      if (t !== null) onTime(t)
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-2000)
    })
    child.on('error', (e) => {
      current = null
      reject(e)
    })
    child.on('close', (code, signal) => {
      current = null
      if (cancelled) reject(new Error(CANCELLED))
      else if (code === 0) resolve()
      else if (signal) reject(new Error('ffmpeg был прерван'))
      else reject(new Error(`ffmpeg завершился с кодом ${code}: ${stderrTail.trim().split('\n').pop() ?? ''}`))
    })
  })
}

const pngBuffer = (dataUrl: string): Buffer => Buffer.from(dataUrl.slice(PNG_PREFIX.length), 'base64')

/** Свободное имя в папке: `name.mp4`, при совпадении `name (2).mp4` и т.д. */
function uniquePath(dir: string, fileName: string): string {
  const { name, ext } = parse(fileName)
  // lstat, а не exists: «висячая» ссылка тоже занимает имя, иначе ffmpeg -y записал бы туда, куда она указывает
  const taken = (p: string): boolean => {
    try {
      lstatSync(p)
      return true
    } catch {
      return false
    }
  }
  let candidate = join(dir, fileName)
  for (let i = 2; taken(candidate); i++) candidate = join(dir, `${name} (${i})${ext}`)
  return candidate
}

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch {
    await copyFile(from, to) // другой диск
  }
}

/**
 * Рендерит клипы. separate: `target` — папка, single: `target` — итоговый файл.
 * Возвращает пути созданных файлов. При отмене и ошибке убирает всё, что успел записать.
 */
export async function runExport(
  request: ExportRequest,
  target: string,
  onProgress: (p: ExportProgress) => void
): Promise<string[]> {
  const req = validateExportRequest(request)
  if (running) throw new Error('Экспорт уже идёт')
  running = true
  cancelled = false
  const created: string[] = []
  let tmp: string | null = null
  try {
    tmp = await mkdtemp(join(tmpdir(), 'hockey-export-'))
    const dir = tmp
    const hold = req.holdSeconds
    const params = { width: req.width, height: req.height, fps: req.fps, holdSeconds: hold }

    // границы клипа приходят из проекта — обрезаем по реальной длине видео, иначе клип
    // с end = 1e9 у видео без звука кодировал бы тишину, пока не кончится диск
    const sources = new Map<string, Promise<{ hasAudio: boolean; duration: number }>>()
    const sourceOf = (path: string): Promise<{ hasAudio: boolean; duration: number }> => {
      let p = sources.get(path)
      if (!p) sources.set(path, (p = probe(path).then((s) => ({ hasAudio: s.audioCodec !== null, duration: s.duration }))))
      return p
    }
    const clips = []
    for (const c of req.clips) {
      const { duration } = await sourceOf(c.videoPath)
      const end = duration > 0 ? Math.min(c.end, duration) : c.end
      if (end > c.start) clips.push({ ...c, end, overlays: c.overlays.filter((o) => o.time <= end) })
    }
    if (!clips.length) throw new Error('Клипы не попадают в видео')

    const durations = clips.map((c) => expectedClipDuration(c, hold))
    const total = durations.reduce((a, b) => a + b, 0)
    if (total > MAX_TOTAL_SECONDS) throw new Error('Слишком длинный экспорт (больше 6 часов)')

    const rendered: string[] = []
    let done = 0
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i]
      if (cancelled) throw new Error(CANCELLED)
      const { hasAudio } = await sourceOf(clip.videoPath)

      const save = async (name: string, dataUrl: string): Promise<string> => {
        const p = join(dir, `c${i}-${name}.png`)
        await writeFile(p, pngBuffer(dataUrl))
        return p
      }
      const overlayPaths = await Promise.all(clip.overlays.map((o, k) => save(`o${k}`, o.png)))
      const captionPath = clip.captionPng ? await save('caption', clip.captionPng) : undefined
      const boardPath = clip.boardPng ? await save('board', clip.boardPng) : undefined
      const scriptPath = join(dir, `c${i}-filter.txt`)

      const outputPath =
        req.mode === 'separate'
          ? uniquePath(target, clipFileName(i, clips.length, clip.title))
          : join(dir, `clip-${String(i + 1).padStart(4, '0')}.mp4`)
      const job = buildClipJob({ clip, params, hasAudio, overlayPaths, captionPath, boardPath, scriptPath, outputPath })
      await writeFile(scriptPath, job.filterScript, 'utf8')

      if (req.mode === 'separate') created.push(outputPath)
      const send = (t: number): void =>
        onProgress({ ratio: total > 0 ? Math.min(1, (done + Math.min(t, durations[i])) / total) : 0, clip: i + 1, clips: clips.length })
      send(0)
      await runFfmpeg(job.args, send)
      done += durations[i]
      rendered.push(outputPath)
    }

    if (req.mode === 'separate') return rendered

    // единая подборка: склеиваем готовые клипы без перекодирования
    const listPath = join(dir, 'list.txt')
    const joined = join(dir, 'joined.mp4')
    await writeFile(listPath, buildConcatList(rendered), 'utf8')
    await runFfmpeg(buildConcatArgs(listPath, joined), () => {})
    if (cancelled) throw new Error(CANCELLED)
    created.push(target)
    await moveFile(joined, target)
    onProgress({ ratio: 1, clip: clips.length, clips: clips.length })
    return [target]
  } catch (e) {
    await Promise.all(created.map((p) => rm(p, { force: true }).catch(() => {})))
    throw cancelled ? new Error(CANCELLED) : e
  } finally {
    running = false
    current = null
    if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}
