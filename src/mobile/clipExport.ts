/**
 * Сохранение момента в MP4 прямо на телефоне: переписываем отрезок плеера MediaRecorder'ом.
 * Нативного ffmpeg в приложении нет, поэтому запись идёт в реальном времени:
 * клип длиной 12 с пишется 12 с. Android WebView поддерживает mp4 (H.264) — проверяем здесь.
 */

const MIMES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4']

export function pickClipMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  return MIMES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null
}

/** В lib.dom captureStream у <video> не описан, в WebView он есть. */
type StreamableVideo = HTMLVideoElement & { captureStream(): MediaStream }

/** Телефон может записать клип: есть captureStream у видео и mp4 у MediaRecorder. */
export function canRecordClip(): boolean {
  return (
    typeof HTMLVideoElement !== 'undefined' &&
    'captureStream' in HTMLVideoElement.prototype &&
    pickClipMime() !== null
  )
}

export class ClipAbort extends Error {
  constructor() {
    super('Запись отменена')
    this.name = 'AbortError'
  }
}

/**
 * Переписать отрезок [from; to] активного видео (время видео, без offset проекта).
 * После записки видео ставится на паузу и возвращается на исходную позицию.
 */
export async function recordClip(
  video: HTMLVideoElement,
  from: number,
  to: number,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal
): Promise<Blob> {
  const mime = pickClipMime()
  if (!mime) throw new Error('Телефон не умеет писать MP4')
  if (!(to - from > 0.2)) throw new Error('Момент слишком короткий')

  const stream = (video as StreamableVideo).captureStream()
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data)
  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime.split(';')[0] }))
    recorder.onerror = () => reject(new Error('Запись прервана'))
  })

  const prevRate = video.playbackRate
  const prevTime = video.currentTime
  let tick: (() => void) | null = null

  const cleanup = (): void => {
    signal?.removeEventListener('abort', abort)
    if (tick) video.removeEventListener('timeupdate', tick)
    if (recorder.state !== 'inactive') recorder.stop()
    video.pause()
    video.playbackRate = prevRate
    video.currentTime = prevTime
    stream.getTracks().forEach((t) => t.stop())
  }
  const abort = (): void => {
    cleanup()
    rejectAbort?.()
  }
  let rejectAbort: (() => void) | null = null
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(new ClipAbort())
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })

  const seeked = new Promise<void>((resolve) => {
    video.addEventListener('seeked', () => resolve(), { once: true })
  })

  try {
    return await Promise.race([
      (async () => {
        video.playbackRate = 1
        video.currentTime = from
        await seeked
        await video.play()
        recorder.start(1000)
        await new Promise<void>((resolve) => {
          tick = () => {
            const ratio = Math.min(1, (video.currentTime - from) / (to - from))
            onProgress?.(ratio)
            if (video.currentTime >= to || video.ended) {
              video.removeEventListener('timeupdate', tick!)
              resolve()
            }
          }
          video.addEventListener('timeupdate', tick)
        })
        cleanup()
        return await finished
      })(),
      aborted
    ])
  } catch (e) {
    cleanup()
    throw e
  }
}

/** Blob → base64 без единого гигантскогоencodeURIComponent: чанками по 64 КБ. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let out = ''
  const CHUNK = 0x10000
  for (let i = 0; i < buf.length; i += CHUNK) {
    out += String.fromCharCode(...buf.subarray(i, i + CHUNK))
  }
  return btoa(out)
}

/** Имя файла клипа: проект + время начала, без запрещённых символов. */
export function clipFileName(projectName: string, startSec: number): string {
  const mm = Math.floor(startSec / 60)
  const ss = Math.floor(startSec % 60)
  const base = projectName.replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 60) || 'момент'
  return `${base} ${mm}m${String(ss).padStart(2, '0')}s.mp4`
}
