import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ConvertProgress, ExportProgress, HockeyApi } from '../shared/types'

const api: HockeyApi = {
  openVideoDialog: () => ipcRenderer.invoke('video:open-dialog'),
  probeVideo: (path) => ipcRenderer.invoke('video:probe', path),
  registerDroppedFile: (file) => ipcRenderer.invoke('video:register-dropped', webUtils.getPathForFile(file)),
  convertVideo: (path) => ipcRenderer.invoke('video:convert', path),
  cancelConvert: () => ipcRenderer.invoke('video:cancel-convert'),
  onConvertProgress: (cb) => {
    const listener = (_e: unknown, p: ConvertProgress): void => cb(p)
    ipcRenderer.on('video:convert-progress', listener)
    return () => ipcRenderer.removeListener('video:convert-progress', listener)
  },
  addVideoDialog: () => ipcRenderer.invoke('video:add-dialog'),
  openProjectDialog: () => ipcRenderer.invoke('project:open-dialog'),
  saveProject: (path, project) => ipcRenderer.invoke('project:save', path, project),
  confirm: (message, detail) => ipcRenderer.invoke('dialog:confirm', message, detail),
  setDirty: (dirty) => ipcRenderer.send('window:set-dirty', dirty),
  setTitle: (title) => ipcRenderer.send('window:set-title', title),
  loadSettings: () => ipcRenderer.sendSync('settings:load'),
  saveSettings: (settings) => ipcRenderer.send('settings:save', settings),
  revealSettings: () => ipcRenderer.invoke('settings:reveal'),
  writeRecovery: (recovery) => ipcRenderer.send('recovery:write', recovery),
  readRecovery: () => ipcRenderer.invoke('recovery:read'),
  exportClips: (request) => ipcRenderer.invoke('export:clips', request),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  onExportProgress: (cb) => {
    const listener = (_e: unknown, p: ExportProgress): void => cb(p)
    ipcRenderer.on('export:progress', listener)
    return () => ipcRenderer.removeListener('export:progress', listener)
  },
  saveTextFile: (suggestedName, content, ext) => ipcRenderer.invoke('file:save-text', suggestedName, content, ext),
  revealFile: (path) => ipcRenderer.invoke('file:reveal', path)
}

contextBridge.exposeInMainWorld('api', api)
