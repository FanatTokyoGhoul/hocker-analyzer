import { app } from 'electron'
import { execFile, spawn, type ChildProcess } from 'child_process'
import { createHash } from 'crypto'
import { chmod, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'fs/promises'
import { createWriteStream, existsSync } from 'fs'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream as WebReadableStream } from 'stream/web'
import { join } from 'path'
import { normalizeVkUrl, type DownloadProgress } from '../shared/vk'
import { sanitizeFileName } from './exportPlan'
import {
  FORMAT_SELECTOR,
  PROGRESS_TEMPLATE,
  ProgressTracker,
  checksumFor,
  errorFromStderr,
  isPostprocessLine,
  parseProgressLine,
  plannedFormats,
  ytDlpAsset
} from './ytdlpParse'

const REPO = 'https://github.com/yt-dlp/yt-dlp/releases'
/** Вывод yt-dlp больше этого — что-то не так (сведения о видео VK — сотни килобайт). */
const MAX_STDOUT = 16 * 1024 * 1024
/** Только видео: временные куски (.part, .ytdl, .f123.mp4) не берём. */
const VIDEO_FILE = /^video\.(mp4|m4v|mkv|webm|mov)$/
/** Временные папки упавших скачиваний старше часа убираем при следующем. */
const STALE_TMP_MS = 3600 * 1000
/** Раз в неделю просим yt-dlp обновиться: VK меняет сайт, и старые версии перестают скачивать. */
const UPDATE_EVERY_MS = 7 * 24 * 3600 * 1000

type Report = (p: DownloadProgress) => void

/** Текущее скачивание: одно за раз. */
let active: { abort: AbortController; child: ChildProcess | null } | null = null

const toolsDir = (): string => join(app.getPath('userData'), 'tools')
/** Куда сохраняются скачанные видео: «Видео/Hockey Analyzer». */
export function downloadsDir(): string {
  // на минимальных Linux без XDG-папки «Видео» Electron бросает исключение — тогда в «Загрузки»
  for (const name of ['videos', 'downloads', 'home'] as const) {
    try {
      return join(app.getPath(name), 'Hockey Analyzer')
    } catch {
      // следующая папка
    }
  }
  return join(app.getPath('userData'), 'Hockey Analyzer')
}

const cancelled = (): Error => new Error('Скачивание отменено')

function progress(phase: DownloadProgress['phase'], extra: Partial<DownloadProgress> = {}): DownloadProgress {
  return { phase, ratio: null, downloaded: 0, total: null, speed: null, eta: null, title: null, ...extra }
}

/** Скачать файл по https с прогрессом; вернуть SHA-256 содержимого. */
async function fetchToFile(url: string, file: string, signal: AbortSignal, onRatio: (r: number | null, done: number, total: number | null) => void): Promise<string> {
  const res = await fetch(url, { signal, redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`GitHub ответил ${res.status} для ${url}`)
  const total = Number(res.headers.get('content-length')) || null
  const hash = createHash('sha256')
  let done = 0
  const tap = new Transform({
    transform(chunk: Buffer, _enc, next) {
      hash.update(chunk)
      done += chunk.length
      onRatio(total ? done / total : null, done, total)
      next(null, chunk)
    }
  })
  // pipeline передаёт ошибку записи (нет места, нет прав) в await, а не роняет main;
  // исполняемым файл становится только после проверки суммы
  await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), tap, createWriteStream(file, { mode: 0o644 }), { signal })
  return hash.digest('hex')
}

/**
 * Готовый к запуску yt-dlp из папки приложения: при первом использовании скачивается с GitHub
 * и сверяется с SHA2-256SUMS того же релиза; дальше раз в неделю обновляется сам (yt-dlp -U).
 */
async function ensureYtDlp(signal: AbortSignal, report: Report): Promise<string> {
  const asset = ytDlpAsset(process.platform, process.arch)
  if (!asset) throw new Error(`Скачивание из VK не поддерживается на ${process.platform}/${process.arch}`)
  const dir = toolsDir()
  const bin = join(dir, asset)
  const marker = join(dir, 'yt-dlp.checked')
  await mkdir(dir, { recursive: true })

  if (!existsSync(bin)) {
    report(progress('tool'))
    await installYtDlp(asset, bin, signal, report).catch((e: Error) => {
      if (signal.aborted) throw cancelled()
      throw new Error(`Не удалось скачать yt-dlp с GitHub: ${e.message}`)
    })
    await writeFile(marker, String(Date.now()))
    return bin
  }

  const checkedAt = await stat(marker).then((s) => s.mtimeMs).catch(() => 0)
  if (Date.now() - checkedAt > UPDATE_EVERY_MS) {
    report(progress('tool'))
    // обновление — по возможности: без сети работаем с тем, что есть. Отменой его не прерываем:
    // оборванное самообновление может оставить испорченный yt-dlp
    await new Promise<void>((resolve) => execFile(bin, ['-U'], { timeout: 30_000 }, () => resolve()))
    if (signal.aborted) throw cancelled()
    await writeFile(marker, String(Date.now()))
  }
  return bin
}

/** Первая установка: сборка из последнего релиза, сверенная с его SHA2-256SUMS. */
async function installYtDlp(asset: string, bin: string, signal: AbortSignal, report: Report): Promise<void> {
  // версию узнаём один раз: сумма и файл — из одного релиза, даже если в этот момент выходит новый
  const latest = await fetch(`${REPO}/latest`, { signal, redirect: 'manual' })
  const tag = /\/tag\/([\w.-]+)$/.exec(latest.headers.get('location') ?? '')?.[1]
  if (!tag) throw new Error(`не удалось узнать последнюю версию (ответ ${latest.status})`)
  const base = `${REPO}/download/${tag}`
  const res = await fetch(`${base}/SHA2-256SUMS`, { signal, redirect: 'follow' })
  if (!res.ok) throw new Error(`GitHub ответил ${res.status}`)
  const expected = checksumFor(await res.text(), asset)
  if (!expected) throw new Error('нет контрольной суммы в релизе')
  const tmp = `${bin}.download`
  try {
    const actual = await fetchToFile(`${base}/${asset}`, tmp, signal, (ratio, downloaded, total) =>
      report(progress('tool', { ratio, downloaded, total }))
    )
    if (actual !== expected) throw new Error('файл не совпал с контрольной суммой, попробуйте ещё раз')
    await chmod(tmp, 0o755)
    await rename(tmp, bin)
  } catch (e) {
    await rm(tmp, { force: true })
    throw e
  }
}

/** Запуск yt-dlp: с onLine — построчно (прогресс), без него — весь вывод одной строкой (сведения о видео). */
function run(bin: string, args: string[], signal: AbortSignal, onLine?: (line: string) => void): Promise<string> {
  // отменили между шагами — процесс не запускаем: на уже отменённый сигнал abort не придёт
  if (signal.aborted) return Promise.reject(cancelled())
  return new Promise((resolve, reject) => {
    // на POSIX своя группа процессов: при отмене гасим и ffmpeg, который запускает yt-dlp
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true })
    if (active) active.child = child
    const chunks: string[] = []
    let size = 0
    let tooBig = false
    let stderr = ''
    let buffered = ''
    const kill = (): void => {
      if (child.exitCode !== null) return
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      else if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
      }
    }
    signal.addEventListener('abort', kill, { once: true })
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      if (!onLine) {
        size += chunk.length
        if (size > MAX_STDOUT) {
          tooBig = true
          kill()
        } else chunks.push(chunk)
        return
      }
      buffered += chunk
      const lines = buffered.split(/\r?\n|\r/)
      buffered = (lines.pop() ?? '').slice(-64 * 1024)
      lines.forEach(onLine)
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-8000)
    })
    child.on('error', (e) => reject(e))
    child.on('close', (code) => {
      signal.removeEventListener('abort', kill)
      if (active?.child === child) active.child = null
      if (signal.aborted) reject(cancelled())
      else if (tooBig) reject(new Error('yt-dlp вернул слишком много данных'))
      else if (code === 0) resolve(chunks.join(''))
      else reject(new Error(errorFromStderr(stderr)))
    })
  })
}

/** Временные папки скачиваний, оборванных падением приложения (вызывается и при запуске). */
export async function removeStaleTemp(dir = downloadsDir()): Promise<void> {
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (!name.startsWith('.downloading-')) continue
    const path = join(dir, name)
    const age = Date.now() - (await stat(path).then((s) => s.mtimeMs).catch(() => Date.now()))
    if (age > STALE_TMP_MS) await rm(path, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** Свободное имя «Название.mp4», «Название (2).mp4», … Скачивание одно за раз, гонкой между проверкой и переносом пренебрегаем. */
function uniquePath(dir: string, base: string, ext: string): string {
  let candidate = join(dir, `${base}${ext}`)
  for (let i = 2; existsSync(candidate); i++) candidate = join(dir, `${base} (${i})${ext}`)
  return candidate
}

/**
 * Скачивает видео VK в «Видео/Hockey Analyzer» и возвращает путь к файлу.
 * Сначала yt-dlp только читает сведения (название, потоки, размеры), затем качает по ним же —
 * так полоса прогресса знает общий размер видео и звука. Файл собирается во временной папке
 * рядом и переносится на место целиком: отменённое или упавшее скачивание не оставляет мусора.
 */
export async function downloadVk(input: string, ffmpeg: string, report: Report): Promise<string> {
  const url = normalizeVkUrl(input)
  if (!url) throw new Error('Это не ссылка на видео VK')
  if (active) throw new Error('Скачивание уже идёт')
  const abort = new AbortController()
  active = { abort, child: null }
  const { signal } = abort
  const outDir = downloadsDir()
  let tmp: string | null = null
  try {
    const bin = await ensureYtDlp(signal, report)
    await mkdir(outDir, { recursive: true })
    await removeStaleTemp(outDir)
    tmp = await mkdtemp(join(outDir, '.downloading-'))

    report(progress('info'))
    // только разборщик VK: иначе ссылка-переадресация (vk.com/away.php?to=…) увела бы yt-dlp на любой сайт;
    // без чужих плагинов и настроек пользователя
    const common = ['--ignore-config', '--no-plugin-dirs', '--use-extractors', 'vk', '--no-playlist', '--no-colors', '-f', FORMAT_SELECTOR]
    const json = await run(bin, [...common, '-J', '--', url], signal)
    const info = JSON.parse(json) as { _type?: string; title?: unknown; requested_formats?: never[] }
    if (info._type === 'playlist') throw new Error('Ссылка ведёт на подборку, а не на одно видео')
    const title = typeof info.title === 'string' && info.title.trim() ? info.title.trim() : 'Видео VK'
    const infoPath = join(tmp, 'info.json')
    await writeFile(infoPath, json)

    const tracker = new ProgressTracker(plannedFormats(info))
    report(progress('video', { title }))
    await run(
      bin,
      [
        ...common,
        '--load-info-json', infoPath,
        '--merge-output-format', 'mp4',
        '--ffmpeg-location', ffmpeg,
        '-P', tmp,
        '-o', 'video.%(ext)s',
        '--newline',
        '--no-mtime',
        '--progress-template', PROGRESS_TEMPLATE
      ],
      signal,
      (line) => {
        const p = parseProgressLine(line)
        if (p) {
          const sum = tracker.update(p)
          report(progress(p.audio ? 'audio' : 'video', { ...sum, speed: p.speed, eta: p.eta, title }))
        } else if (isPostprocessLine(line)) {
          report(progress('merge', { ratio: 1, title }))
        }
      }
    )

    const file = (await readdir(tmp)).find((f) => VIDEO_FILE.test(f))
    if (!file) throw new Error('yt-dlp не сохранил видео')
    const ext = file.slice(file.lastIndexOf('.'))
    const target = uniquePath(outDir, sanitizeFileName(title, 120), ext)
    await rename(join(tmp, file), target)
    return target
  } catch (e) {
    // fetch при отмене бросает свой AbortError — для пользователя это просто «отменено»
    if (signal.aborted) throw cancelled()
    throw e
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
    active = null
  }
}

export function cancelVkDownload(): void {
  active?.abort.abort()
}
