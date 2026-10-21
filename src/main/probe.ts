/** Чистые функции разбора вывода ffprobe/ffmpeg — без зависимостей от Electron, покрыты тестами. */

export type ProbeStream = {
  codec_type?: string
  codec_name?: string
  profile?: string
  pix_fmt?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  duration?: string
}

export type ProbeJson = {
  streams?: ProbeStream[]
  format?: { duration?: string; format_name?: string }
}

export type ProbeSummary = {
  fps: number
  duration: number
  width: number
  height: number
  videoCodec: string
  audioCodec: string | null
  needsConversion: boolean
  conversionReason: string | null
  variableFrameRate: boolean
}

export function parseFrameRate(value: string | undefined): number | null {
  if (!value) return null
  const [num, den = '1'] = value.split('/')
  const n = Number(num)
  const d = Number(den)
  if (!Number.isFinite(n) || !Number.isFinite(d) || n <= 0 || d <= 0) return null
  const fps = n / d
  // ffprobe иногда отдаёт мусор вроде 90000/1 для таймбейза
  return fps > 0 && fps <= 1000 ? fps : null
}

const PLAYABLE_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1'])
const PLAYABLE_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_f32le'])

export function summarizeProbe(json: ProbeJson): ProbeSummary {
  const streams = json.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video')
  if (!video) throw new Error('В файле нет видеодорожки')
  const audio = streams.find((s) => s.codec_type === 'audio')

  const avg = parseFrameRate(video.avg_frame_rate)
  const base = parseFrameRate(video.r_frame_rate)
  const fps = avg ?? base ?? 30
  // у VFR-записей средняя частота заметно расходится с базовой (r_frame_rate)
  const variableFrameRate = avg !== null && base !== null && Math.abs(avg - base) / base > 0.002
  const duration = Number(json.format?.duration ?? video.duration ?? 0) || 0
  const videoCodec = video.codec_name ?? 'unknown'
  const audioCodec = audio?.codec_name ?? null

  let reason: string | null = null
  if (!PLAYABLE_VIDEO.has(videoCodec)) {
    reason = `кодек ${videoCodec.toUpperCase()} не поддерживается встроенным плеером`
  } else if (videoCodec === 'h264' && /10|4:2:2|4:4:4/.test(video.profile ?? '')) {
    reason = `профиль H.264 «${video.profile}» не поддерживается встроенным плеером`
  } else if (audioCodec && !PLAYABLE_AUDIO.has(audioCodec)) {
    reason = `аудиокодек ${audioCodec.toUpperCase()} не поддерживается встроенным плеером`
  }

  return {
    fps,
    duration,
    width: video.width ?? 0,
    height: video.height ?? 0,
    videoCodec,
    audioCodec,
    needsConversion: reason !== null,
    conversionReason: reason,
    variableFrameRate
  }
}

/** Достаёт текущую позицию (сек) из блока `-progress pipe:1`. */
export function parseProgressTime(chunk: string): number | null {
  let last: number | null = null
  for (const line of chunk.split(/\r?\n/)) {
    const m = /^out_time_(?:us|ms)=(\d+)$/.exec(line.trim())
    // и out_time_us, и out_time_ms у ffmpeg — в микросекундах
    if (m) last = Number(m[1]) / 1_000_000
  }
  return last
}

/**
 * Только локальные файлы и обычные видеоконтейнеры: иначе файл «match.mp4», который на деле
 * HLS/concat-плейлист, мог бы подтянуть содержимое других файлов в результат конвертации.
 */
export const INPUT_WHITELIST = [
  '-protocol_whitelist', 'file',
  '-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mpegts'
]

export function ffmpegConvertArgs(input: string, output: string, fps: number): string[] {
  return [
    '-y',
    ...INPUT_WHITELIST,
    '-i', input,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    // постоянная частота кадров — чтобы шаг 1/fps всегда был ровно одним кадром
    '-fps_mode', 'cfr',
    '-r', fps.toFixed(3),
    // частые ключевые кадры — точная и быстрая перемотка и покадровый шаг
    '-g', '10',
    '-keyint_min', '10',
    '-sc_threshold', '0',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    '-nostats',
    output
  ]
}
