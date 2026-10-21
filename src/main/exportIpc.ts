import { BrowserWindow, dialog, ipcMain } from 'electron'
import { dirname, join, resolve } from 'path'
import type { ExportProgress, ExportRequest, ExportResult } from '../shared/types'
import { cancelExport, runExport, validateExportRequest } from './export'
import { sanitizeFileName } from './exportPlan'

export { cancelExport }

export function registerExportIpc(deps: {
  getWindow(): BrowserWindow | null
  isAllowedMedia(path: string): boolean
  /** Готовые файлы — чтобы их можно было показать в папке. */
  onExported?(paths: string[]): void
}): void {
  ipcMain.handle('export:clips', async (e, raw: ExportRequest): Promise<ExportResult | null> => {
    const request = validateExportRequest(raw)
    for (const c of request.clips) {
      const path = resolve(c.videoPath)
      if (!deps.isAllowedMedia(path)) throw new Error('Файл не был открыт пользователем')
      // ffmpeg получает ровно тот путь, который проверили
      c.videoPath = path
    }

    const win = deps.getWindow()
    let target: string
    if (request.mode === 'single') {
      const options = {
        title: 'Экспорт клипов',
        defaultPath: join(dirname(resolve(request.clips[0].videoPath)), `${sanitizeFileName(request.suggestedName)}.mp4`),
        filters: [{ name: 'Видео MP4', extensions: ['mp4'] }]
      }
      const r = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
      if (r.canceled || !r.filePath) return null
      target = r.filePath
    } else {
      const options = {
        title: 'Папка для клипов',
        defaultPath: dirname(resolve(request.clips[0].videoPath)),
        properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>
      }
      const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      if (r.canceled || r.filePaths.length === 0) return null
      target = r.filePaths[0]
    }

    const paths = await runExport(request, target, (p: ExportProgress) => {
      if (!e.sender.isDestroyed()) e.sender.send('export:progress', p)
    })
    deps.onExported?.(paths)
    return { paths }
  })

  ipcMain.handle('export:cancel', () => cancelExport())
}
