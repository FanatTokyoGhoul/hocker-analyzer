import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import { readFile, rename, stat, unlink, writeFile } from 'fs/promises'
import { basename, dirname, extname, join, resolve } from 'path'
import type { OpenedProject, Project, Recovery, VideoInfo } from '../shared/types'
import { parseProject, serializeProject } from '../shared/project'
import { FFMPEG, cancelConvert, convert, convertedPathFor, probe } from './ffmpeg'
import { cancelVkDownload, downloadVk, removeStaleTemp } from './vkDownload'
import { MEDIA_SCHEME, fromMediaUrl, serveFile, toMediaUrl } from './media'
import { flushSettings, loadSettings, saveSettings, settingsPath, applyAuthorProfileDir } from './settings'
import { cancelExport, registerExportIpc } from './exportIpc'
import { sanitizeFileName } from './exportPlan'
import { publishRemote, startRemote, stopRemote } from './remote'
import { clearRecoverySync, readRecovery, writeRecovery } from './recovery'

applyAuthorProfileDir()

protocol.registerSchemesAsPrivileged([
  { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }
])

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mts', 'ts']

/** Протокол media:// отдаёт только файлы, которые пользователь сам выбрал. */
const allowedMedia = new Set<string>()
/** Пути проектов, полученные из диалогов, — перезаписывать без диалога можно только их. */
const trustedProjectPaths = new Set<string>()
/** Файлы, которые приложение само записало (CSV, экспорт), — их можно показать в папке. */
const revealablePaths = new Set<string>()

/** Черновик — это JSON проекта; больше — значит, что-то не так. */
const MAX_RECOVERY_CHARS = 50 * 1024 * 1024

const isNetworkPath = (p: string): boolean => /^(\\\\|\/\/)/.test(p)

/**
 * Путь, пришедший не из системного диалога (drag&drop, JSON проекта), принимаем только
 * если это локальный обычный файл с видеорасширением: так чужой проект не заставит
 * обратиться к SMB-шаре (утечка NTLM-хэша) или открыть произвольный файл через media://.
 */
async function isSafeVideoPath(p: string): Promise<boolean> {
  if (isNetworkPath(p)) return false
  if (!VIDEO_EXTENSIONS.includes(extname(p).slice(1).toLowerCase())) return false
  try {
    return (await stat(p)).isFile()
  } catch {
    return false
  }
}

/**
 * Ищет видео проекта: по сохранённому пути или рядом с файлом проекта (проект перенесли вместе с видео).
 * Сетевые и «не видео» пути из чужого JSON не трогаем вовсе — пусть пользователь укажет файл сам.
 * Найденные файлы разрешаются для media://, пути исправляются на месте; возвращает id ненайденных.
 */
async function locateVideos(project: Project, projectDir: string | null): Promise<string[]> {
  const missing: string[] = []
  for (const v of project.videos) {
    if (isNetworkPath(v.path) || !(await isSafeVideoPath(resolve(v.path)))) {
      const sibling = projectDir ? join(projectDir, basename(v.path.replace(/\\/g, '/'))) : null
      if (sibling && (await isSafeVideoPath(sibling))) v.path = sibling
      else {
        missing.push(v.id)
        continue
      }
    }
    allowedMedia.add(resolve(v.path))
  }
  project.videoPath = project.videos[0].path
  return missing
}

let win: BrowserWindow | null = null
let dirty = false

async function describeVideo(filePath: string): Promise<VideoInfo> {
  const path = resolve(filePath)
  const summary = await probe(path)
  allowedMedia.add(path)
  return { path, url: toMediaUrl(path), ...summary }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#14171c',
    title: 'Hockey Analyzer',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => win?.show())

  win.on('close', (e) => {
    if (!dirty || !win) return
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Выйти без сохранения', 'Отмена'],
      defaultId: 1,
      cancelId: 1,
      message: 'В проекте есть несохранённые изменения',
      detail: 'Если выйти сейчас, разметка с момента последнего сохранения будет потеряна.'
    })
    if (choice === 1) e.preventDefault()
    // пользователь сам отказался от изменений — восстанавливать нечего
    else clearRecoverySync()
  })

  // Внешние ссылки — в системный браузер, навигацию самого окна запрещаем
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  // перезагрузка или падение окна: интерфейс начнёт «с выключенным пультом» — сервер тоже выключаем
  // окно перезагрузилось или упало — пульт и скачивание больше некому показывать
  const stopBackground = (): void => {
    stopRemote()
    cancelVkDownload()
  }
  win.webContents.on('did-start-loading', stopBackground)
  win.webContents.on('render-process-gone', stopBackground)

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  registerExportIpc({
    getWindow: () => win,
    isAllowedMedia: (p) => allowedMedia.has(p),
    onExported: (paths) => paths.forEach((p) => revealablePaths.add(resolve(p)))
  })

  const pickVideo = async (title: string): Promise<VideoInfo | null> => {
    const res = await dialog.showOpenDialog(win!, {
      title,
      properties: ['openFile'],
      filters: [{ name: 'Видео', extensions: VIDEO_EXTENSIONS }, { name: 'Все файлы', extensions: ['*'] }]
    })
    if (res.canceled || !res.filePaths[0]) return null
    return describeVideo(res.filePaths[0])
  }
  ipcMain.handle('video:open-dialog', () => pickVideo('Открыть видео матча'))
  ipcMain.handle('video:add-dialog', () => pickVideo('Добавить видео в проект'))

  // Путь берётся в preload из File, полученного через drag&drop
  ipcMain.handle('video:register-dropped', async (_e, filePath: string) => {
    if (typeof filePath !== 'string' || !(await isSafeVideoPath(resolve(filePath)))) {
      throw new Error('Перетащите видеофайл (mp4, mov, mkv, webm, avi, ts)')
    }
    return describeVideo(filePath)
  })

  ipcMain.handle('video:probe', (_e, filePath: string) => {
    if (!allowedMedia.has(resolve(filePath))) throw new Error('Файл не был открыт пользователем')
    return describeVideo(filePath)
  })

  ipcMain.handle('video:convert', async (e, filePath: string) => {
    const input = resolve(filePath)
    if (!allowedMedia.has(input)) throw new Error('Файл не был открыт пользователем')
    const { duration, fps } = await probe(input)
    const output = convertedPathFor(input)
    try {
      await convert(input, output, duration, fps, (ratio, outTime) => {
        if (!e.sender.isDestroyed()) e.sender.send('video:convert-progress', { ratio, outTime })
      })
    } catch (err) {
      await unlink(output).catch(() => undefined)
      throw err
    }
    return describeVideo(output)
  })

  ipcMain.handle('video:cancel-convert', () => cancelConvert())

  // ссылка проверяется в downloadVk: только видео VK, скачивание в «Видео/Hockey Analyzer»
  ipcMain.handle('vk:download', async (e, url: unknown) => {
    if (typeof url !== 'string') throw new Error('Нужна ссылка на видео VK')
    const path = await downloadVk(url, FFMPEG, (p) => {
      if (!e.sender.isDestroyed()) e.sender.send('vk:progress', p)
    })
    revealablePaths.add(resolve(path))
    return describeVideo(path)
  })
  ipcMain.handle('vk:cancel', () => cancelVkDownload())

  ipcMain.handle('project:open-dialog', async (): Promise<OpenedProject | null> => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Открыть проект',
      properties: ['openFile'],
      filters: [{ name: 'Проект Hockey Analyzer', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePaths[0]) return null
    const path = res.filePaths[0]
    trustedProjectPaths.add(resolve(path))
    const project = parseProject(JSON.parse(await readFile(path, 'utf8')))
    const missingVideos = await locateVideos(project, dirname(path))
    return { path, project, missingVideos }
  })

  ipcMain.handle('project:save', async (_e, path: string | null, project: Project) => {
    let target = path
    if (target && !trustedProjectPaths.has(resolve(target))) target = null
    if (!target) {
      const res = await dialog.showSaveDialog(win!, {
        title: 'Сохранить проект',
        defaultPath: project.videoPath.replace(/\.[^./\\]+$/, '') + '.hockey.json',
        filters: [{ name: 'Проект Hockey Analyzer', extensions: ['json'] }]
      })
      if (res.canceled || !res.filePath) return null
      target = res.filePath
      trustedProjectPaths.add(resolve(target))
    }
    // Пишем во временный файл и переименовываем, чтобы не испортить проект при сбое
    const tmp = `${target}.tmp`
    await writeFile(tmp, serializeProject(parseProject(project)), 'utf8')
    await rename(tmp, target)
    // работа сохранена — черновик больше не нужен; удаляем здесь, а не из рендерера, чтобы
    // «сохранил и сразу закрыл» не оставлял устаревшего черновика
    void writeRecovery(null)
    return target
  })

  ipcMain.on('recovery:write', (_e, data: { savedAt: number; projectPath: string | null; project: unknown } | null) => {
    if (!data) return void writeRecovery(null)
    try {
      if (JSON.stringify(data).length > MAX_RECOVERY_CHARS) throw new Error('черновик слишком большой')
      // путь проекта запоминаем, только если он уже доверенный, — иначе черновик стал бы способом записать файл куда угодно
      const projectPath = typeof data.projectPath === 'string' && trustedProjectPaths.has(resolve(data.projectPath)) ? resolve(data.projectPath) : null
      void writeRecovery({ savedAt: Number(data.savedAt) || Date.now(), projectPath, project: parseProject(data.project) })
    } catch (e) {
      console.error('Черновик отклонён:', e)
    }
  })

  ipcMain.handle('recovery:read', async (): Promise<Recovery | null> => {
    const r = await readRecovery()
    if (!r) return null
    if (r.projectPath && !isNetworkPath(r.projectPath)) trustedProjectPaths.add(resolve(r.projectPath))
    else r.projectPath = null
    const missingVideos = await locateVideos(r.project, r.projectPath ? dirname(r.projectPath) : null)
    return { ...r, missingVideos }
  })

  ipcMain.handle('file:save-text', async (_e, suggestedName: string, content: string, ext: string) => {
    if (typeof content !== 'string' || content.length > 50 * 1024 * 1024) throw new Error('Слишком большой файл')
    // рендерер не выбирает расширение произвольно — только текстовые форматы
    const extension = ext === 'csv' ? 'csv' : 'txt'
    const name = `${sanitizeFileName(String(suggestedName).replace(/\.[^.]*$/, ''), 120)}.${extension}`
    const res = await dialog.showSaveDialog(win!, {
      title: 'Сохранить файл',
      defaultPath: join(app.getPath('documents'), name),
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
    })
    if (res.canceled || !res.filePath) return null
    await writeFile(res.filePath, content, 'utf8')
    revealablePaths.add(resolve(res.filePath))
    return res.filePath
  })

  ipcMain.handle('file:reveal', (_e, path: string) => {
    if (typeof path === 'string' && revealablePaths.has(resolve(path))) shell.showItemInFolder(path)
  })

  // пульт с телефона: команды идут в рендерер, как нажатия клавиш; состояние — обратно на телефон
  ipcMain.handle('remote:start', () =>
    startRemote({
      onCommand: (cmd) => win?.webContents.send('remote:command', cmd),
      onStatus: (status) => win?.webContents.send('remote:status', status),
      isAllowedMedia: (p) => allowedMedia.has(p)
    })
  )
  ipcMain.handle('remote:stop', () => stopRemote())
  ipcMain.on('remote:state', (_e, payload) => publishRemote(payload))

  ipcMain.handle('dialog:confirm', async (_e, message: string, detail?: string) => {
    const res = await dialog.showMessageBox(win!, {
      type: 'question',
      buttons: ['Продолжить', 'Отмена'],
      defaultId: 1,
      cancelId: 1,
      message,
      detail
    })
    return res.response === 0
  })

  // синхронно: рендереру настройки нужны до первой отрисовки
  ipcMain.on('settings:load', (e) => {
    e.returnValue = { settings: loadSettings(), path: settingsPath() }
  })
  ipcMain.on('settings:save', (_e, settings: unknown) => saveSettings(settings))
  // путь фиксированный (не от рендерера), поэтому показывать его в файловом менеджере безопасно
  ipcMain.handle('settings:reveal', () => shell.showItemInFolder(settingsPath()))

  ipcMain.on('window:set-dirty', (_e, value: boolean) => {
    dirty = value
  })
  ipcMain.on('window:set-title', (_e, title: string) => win?.setTitle(title))
}

app.whenReady().then(() => {
  // хвосты скачиваний из VK, оборванных падением приложения
  void removeStaleTemp().catch(() => undefined)
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const filePath = resolve(fromMediaUrl(request.url))
    if (!allowedMedia.has(filePath)) return new Response('Forbidden', { status: 403 })
    try {
      return await serveFile(filePath, request.headers.get('range'))
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', flushSettings)

app.on('window-all-closed', () => {
  cancelConvert()
  cancelExport()
  cancelVkDownload()
  stopRemote()
  flushSettings()
  if (process.platform !== 'darwin') app.quit()
})
