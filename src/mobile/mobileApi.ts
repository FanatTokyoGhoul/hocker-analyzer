import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { parseProject, serializeProject } from '../shared/project'
import { sanitizeSettings } from '../shared/settings'
import type { HockeyApi, OpenedProject, Project, Recovery, VideoInfo } from '../shared/types'
import type { DownloadProgress } from '../shared/vk'
import { normalizeVkUrl } from '../shared/vk'
import { HockeyFiles, HockeyVk, isIOS, videoUrl } from './native'
import { fileNameOf, projectFileName, projectForFile, projectFromFile, type VideoRegistry } from './transfer'
import { parseVkShow, pickVkStream, vkFileName, vkVideoId } from './vkParse'

/**
 * HockeyApi на телефоне: файлы — через системный выбор документов, настройки и черновик — в localStorage.
 * Видео из VK скачивает нативный плагин (своими запросами, как десктоп через yt-dlp).
 * Экспорт клипов, конвертация и пульт — только на компьютере.
 */

const KEY = {
  settings: 'hockey.settings',
  recovery: 'hockey.recovery',
  /** Имя видео → content:// — чтобы проект с компьютера нашёл видео, уже выбранные на телефоне. */
  videos: 'hockey.videos',
  /** content:// → имя файла (видео и проекты) — для заголовков и файла проекта. */
  names: 'hockey.names',
  /** Файлы проектов, которые можно перезаписывать. */
  writable: 'hockey.writable'
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // переполнено хранилище — черновик/настройки не сохранятся, но работа в памяти продолжается
  }
}

/** Имена — в памяти: displayName зовётся на каждом кадре видео, разбирать JSON каждый раз дорого. */
let names: Record<string, string> | null = null
const namesMap = (): Record<string, string> => (names ??= read<Record<string, string>>(KEY.names, {}))

function remember(uri: string, name: string, video: boolean): void {
  if (namesMap()[uri] !== name) {
    names = { ...namesMap(), [uri]: name }
    write(KEY.names, names)
  }
  if (video && read<VideoRegistry>(KEY.videos, {})[name] !== uri) write(KEY.videos, { ...read<VideoRegistry>(KEY.videos, {}), [name]: uri })
}

/** Имя файла по content:// или пути. */
export function displayName(path: string): string {
  return namesMap()[path] ?? fileNameOf(path)
}

const unavailable = (what: string) => (): never => {
  throw new Error(`${what} — только в версии для компьютера`)
}
const noSubscription = (): (() => void) => () => undefined

const CODECS: Record<string, string> = { 'video/avc': 'h264', 'video/hevc': 'hevc', 'video/x-vnd.on2.vp9': 'vp9', 'video/av01': 'av1' }

/** Локальное видео на данном устройстве: Android — content:// из выбора, iOS — file:// из выбора или папки VK. */
function isLocalVideo(path: string): boolean {
  return isIOS ? path.startsWith('file://') : isContentUri(path)
}

const isContentUri = (path: string): boolean => path.startsWith('content://')

async function probeVideo(path: string): Promise<VideoInfo> {
  if (!isLocalVideo(path)) throw new Error(`видео «${fileNameOf(path)}» не выбрано на этом телефоне`)
  const p = await HockeyFiles.probe({ uri: path })
  remember(path, p.name, true)
  return {
    path,
    url: videoUrl(path),
    fps: p.fps,
    duration: p.duration,
    width: p.width,
    height: p.height,
    videoCodec: CODECS[p.codec] ?? p.codec.replace(/^video\//, ''),
    audioCodec: null,
    // что WebView не воспроизведёт, выяснится при загрузке (onError) — перекодировать на телефоне нечем
    needsConversion: false,
    conversionReason: null,
    variableFrameRate: false
  }
}

async function pickVideo(): Promise<VideoInfo | null> {
  const picked = await HockeyFiles.pickVideo()
  if (!picked.uri) return null
  remember(picked.uri, picked.name ?? fileNameOf(picked.uri), true)
  return probeVideo(picked.uri)
}

/** Видео, которых на телефоне нет: путь не content:// (проект с компьютера, видео ещё не выбирали). */
const missingOf = (project: Project): string[] => project.videos.filter((v) => !isContentUri(v.path)).map((v) => v.id)

const fileText = (project: Project): string => serializeProject(parseProject(projectForFile(project, displayName)))

/**
 * Видео подставлено по имени — проверяем, что это то же видео: у двух матчей бывает одинаковое имя (video.mp4 из Telegram).
 * Длительность не совпала или файл недоступен — видео остаётся ненайденным, его укажут вручную.
 */
async function verifyByDuration(file: Project, mapped: Project): Promise<Project> {
  const videos = await Promise.all(
    mapped.videos.map(async (v, i) => {
      const original = file.videos[i]
      if (!isContentUri(v.path) || original.path === v.path) return v
      try {
        const p = await HockeyFiles.probe({ uri: v.path })
        if (original.duration === undefined || Math.abs(p.duration - original.duration) <= 1) return v
      } catch {
        // доступ к файлу потерян
      }
      return { ...v, path: fileNameOf(original.path) }
    })
  )
  return { ...mapped, videos, videoPath: videos[0]?.path ?? mapped.videoPath }
}

async function openProjectDialog(): Promise<OpenedProject | null> {
  const picked = await HockeyFiles.pickProject()
  if (!picked.uri || picked.text === undefined) return null
  const file = parseProject(JSON.parse(picked.text))
  const project = await verifyByDuration(file, projectFromFile(file, read<VideoRegistry>(KEY.videos, {})))
  remember(picked.uri, picked.name ?? 'проект.hockey.json', false)
  const writable = new Set(read<string[]>(KEY.writable, []))
  if (picked.writable) writable.add(picked.uri)
  else writable.delete(picked.uri)
  write(KEY.writable, [...writable])
  return { path: picked.uri, project, missingVideos: missingOf(project) }
}

async function saveProject(path: string | null, project: Project): Promise<string | null> {
  const text = fileText(project)
  let target = path
  let written = false
  if (target && read<string[]>(KEY.writable, []).includes(target)) {
    try {
      await HockeyFiles.writeDocument({ uri: target, text })
      written = true
    } catch {
      // файл удалили или отозвали доступ — сохраняем как новый
      write(KEY.writable, read<string[]>(KEY.writable, []).filter((u) => u !== target))
    }
  }
  if (!written) {
    const created = await HockeyFiles.createDocument({ name: projectFileName(project, displayName), text })
    if (!created.uri) return null
    target = created.uri
    remember(target, created.name ?? projectFileName(project, displayName), false)
    write(KEY.writable, [...new Set([...read<string[]>(KEY.writable, []), target])])
  }
  // работа сохранена — черновик больше не нужен (как на компьютере)
  write(KEY.recovery, null)
  return target
}

/** Отправить проект на компьютер: Telegram, почта, Google Диск, Quick Share — что выберет тренер. */
export async function shareProject(project: Project): Promise<void> {
  const name = projectFileName(project, displayName)
  const { uri } = await Filesystem.writeFile({ path: name, data: fileText(project), directory: Directory.Cache, encoding: Encoding.UTF8 })
  await Share.share({ title: name, files: [uri], dialogTitle: 'Отправить проект на компьютер' })
}

/**
 * Скачивание VK на телефоне: POST al_video.php act=show → лучший поток → файл в папку приложения.
 * Прогресс шлёт нативный плагин; отмена — HockeyVk.cancel.
 */
const vkSubscribers = new Set<(p: DownloadProgress) => void>()
let vkEvents: Promise<void> | null = null
let vkTitle: string | null = null

function vkReport(p: DownloadProgress): void {
  for (const cb of vkSubscribers) cb({ ...p, title: p.title ?? vkTitle })
}

function ensureVkEvents(): void {
  vkEvents ??= HockeyVk.addListener('vkProgress', (e) => vkReport({ ...e, title: null })).then(() => undefined)
}

async function downloadVk(input: string): Promise<VideoInfo> {
  const url = normalizeVkUrl(input)
  if (!url) throw new Error('Это не ссылка на видео VK')
  const video = vkVideoId(url)
  if (!video) throw new Error('В адресе нет идентификатора видео')
  ensureVkEvents()
  vkTitle = null
  vkReport({ phase: 'info', ratio: null, downloaded: 0, total: null, speed: null, eta: null, title: null })
  // ответ с потоками VK отдаёт анонимно только act=show с десктопным UA и Referer (HockeyVkPlugin)
  const show = await HockeyVk.fetchText({ url: 'https://vk.com/al_video.php', method: 'POST', body: `act=show&video=${video}&al=1`, referer: 'https://vk.com/al_video.php' })
  const info = parseVkShow(show.text)
  const stream = pickVkStream(info.streams)
  if (!stream) throw new Error('VK не отдал ссылки на потоки — попробуйте на компьютере')
  vkTitle = info.title
  const name = vkFileName(info.title)
  const { uri, name: saved } = await HockeyVk.download({ url: stream.url, name, referer: 'https://vk.com/' })
  const result = await probeVideo(uri)
  remember(uri, saved || name, true)
  return result
}

export function createMobileApi(): HockeyApi {
  return {
    openVideoDialog: pickVideo,
    addVideoDialog: pickVideo,
    probeVideo,
    registerDroppedFile: unavailable('Перетаскивание файлов'),
    convertVideo: unavailable('Перекодирование видео'),
    cancelConvert: async () => undefined,
    onConvertProgress: noSubscription,
    downloadVk,
    cancelVkDownload: async () => {
      await HockeyVk.cancel()
    },
    onVkProgress: (cb) => {
      vkSubscribers.add(cb)
      ensureVkEvents()
      return () => vkSubscribers.delete(cb)
    },
    openProjectDialog,
    saveProject,
    confirm: async (message, detail) => window.confirm(detail ? `${message}\n\n${detail}` : message),
    setDirty: () => undefined,
    setTitle: () => undefined,
    loadSettings: () => ({ settings: sanitizeSettings(read<unknown>(KEY.settings, null)), path: '' }),
    saveSettings: (settings) => write(KEY.settings, settings),
    revealSettings: async () => undefined,
    writeRecovery: (recovery) => write(KEY.recovery, recovery),
    readRecovery: async () => {
      const r = read<Omit<Recovery, 'missingVideos'> | null>(KEY.recovery, null)
      if (!r) return null
      try {
        const project = parseProject(r.project)
        return { savedAt: r.savedAt, projectPath: r.projectPath, project, missingVideos: missingOf(project) }
      } catch {
        write(KEY.recovery, null)
        return null
      }
    },
    exportClips: unavailable('Экспорт клипов'),
    cancelExport: async () => undefined,
    onExportProgress: noSubscription,
    saveTextFile: unavailable('Сохранение CSV'),
    revealFile: async () => undefined,
    startRemote: unavailable('Пульт с телефона'),
    stopRemote: async () => undefined,
    publishRemoteState: () => undefined,
    onRemoteCommand: noSubscription,
    onRemoteStatus: noSubscription
  }
}
