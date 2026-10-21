import { app } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { mkdir, rename, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { sanitizeSettings, type Settings } from '../shared/settings'

/** Тег автора в пути профиля: ~/.config/ftg/hockey-analyzer, %APPDATA%\ftg\hockey-analyzer, … */
export const AUTHOR_TAG = 'ftg'
export const APP_DIR = 'hockey-analyzer'
const FILE_VERSION = 1

/**
 * Переносит профиль приложения (настройки, кэш Chromium) в папку с тегом автора.
 * Вызывать до app.whenReady(). Явный --user-data-dir (например, в e2e) имеет приоритет.
 */
export function applyAuthorProfileDir(): void {
  if (app.commandLine.hasSwitch('user-data-dir')) return
  app.setPath('userData', join(app.getPath('appData'), AUTHOR_TAG, APP_DIR))
}

export function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

let cache: Settings | null = null
let timer: NodeJS.Timeout | null = null
let writing: Promise<void> = Promise.resolve()

const serialize = (s: Settings): string => JSON.stringify({ version: FILE_VERSION, ...s }, null, 2) + '\n'

/** Читает настройки (синхронно — нужны рендереру до первой отрисовки). Битый файл сохраняется как .bak. */
export function loadSettings(): Settings {
  if (cache) return cache
  const path = settingsPath()
  let raw: unknown = null
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      try {
        renameSync(path, `${path}.bak`)
      } catch {
        // не получилось сохранить копию — просто начнём с умолчаний
      }
    }
  }
  cache = sanitizeSettings(raw)
  return cache
}

/**
 * Запоминает новые настройки и пишет файл с задержкой: пипетка цвета шлёт изменения
 * десятками в секунду. Записи идут строго по очереди, файл заменяется атомарно.
 */
export function saveSettings(raw: unknown): Settings {
  cache = sanitizeSettings(raw)
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    const snapshot = serialize(cache!)
    writing = writing.then(async () => {
      const path = settingsPath()
      await mkdir(dirname(path), { recursive: true })
      await writeFile(`${path}.tmp`, snapshot, 'utf8')
      await rename(`${path}.tmp`, path)
    }).catch((e) => console.error('Не удалось сохранить настройки:', e))
  }, 300)
  return cache
}

/** Дописывает отложенное сохранение при выходе. */
export function flushSettings(): void {
  if (!timer || !cache) return
  clearTimeout(timer)
  timer = null
  try {
    writeFileSync(settingsPath(), serialize(cache), 'utf8')
  } catch (e) {
    console.error('Не удалось сохранить настройки:', e)
  }
}
