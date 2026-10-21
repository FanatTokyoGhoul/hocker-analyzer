import { execFile, spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { INPUT_WHITELIST, ffmpegConvertArgs, parseProgressTime, summarizeProbe, type ProbeSummary } from './probe'

// В собранном приложении бинарники распакованы рядом с asar (см. asarUnpack в electron-builder.yml)
const unpacked = (p: string): string => p.replace(`app.asar${'/'}`, 'app.asar.unpacked/').replace('app.asar\\', 'app.asar.unpacked\\')

export const FFMPEG = unpacked(ffmpegStatic ?? 'ffmpeg')
const FFPROBE = unpacked(ffprobeStatic.path)

export function probe(filePath: string): Promise<ProbeSummary> {
  return new Promise((resolve, reject) => {
    execFile(
      FFPROBE,
      ['-v', 'error', ...INPUT_WHITELIST, '-print_format', 'json', '-show_streams', '-show_format', filePath],
      { maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`ffprobe не смог прочитать файл: ${stderr.trim() || err.message}`))
        try {
          resolve(summarizeProbe(JSON.parse(stdout)))
        } catch (e) {
          reject(e)
        }
      }
    )
  })
}

export function convertedPathFor(input: string): string {
  const dir = dirname(input)
  const base = basename(input, extname(input))
  let candidate = join(dir, `${base}.h264.mp4`)
  for (let i = 2; existsSync(candidate); i++) candidate = join(dir, `${base}.h264-${i}.mp4`)
  return candidate
}

let current: ChildProcess | null = null

export function convert(
  input: string,
  output: string,
  duration: number,
  fps: number,
  onProgress: (ratio: number, outTime: number) => void
): Promise<void> {
  if (current) return Promise.reject(new Error('Конвертация уже идёт'))
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ffmpegConvertArgs(input, output, fps), { stdio: ['ignore', 'pipe', 'pipe'] })
    current = child
    let stderrTail = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      const t = parseProgressTime(chunk)
      if (t !== null) onProgress(duration > 0 ? Math.min(1, t / duration) : 0, t)
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
      if (code === 0) resolve()
      else if (signal) reject(new Error('Конвертация отменена'))
      else reject(new Error(`ffmpeg завершился с кодом ${code}: ${stderrTail.trim().split('\n').pop() ?? ''}`))
    })
  })
}

export function cancelConvert(): void {
  current?.kill('SIGKILL')
}
