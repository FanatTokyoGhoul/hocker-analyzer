import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

// electron в юнит-тестах нет — подменяем app.getPath на временную папку
const dir = mkdtempSync(join(tmpdir(), 'hockey-settings-'))
vi.mock('electron', () => ({ app: { getPath: () => dir, commandLine: { hasSwitch: () => false }, setPath: vi.fn() } }))

const load = async (): Promise<typeof import('./settings')> => {
  vi.resetModules()
  return import('./settings')
}

describe('settings.json', () => {
  it('без файла — умолчания; сохранение пишет JSON с версией после задержки', async () => {
    const s = await load()
    expect(s.loadSettings().holdMode).toBe('timer')
    s.saveSettings({ ...s.loadSettings(), holdMode: 'key', stepMs: 250 })
    expect(existsSync(s.settingsPath())).toBe(false) // ещё не записан — ждём задержку
    await new Promise((r) => setTimeout(r, 450))
    const file = JSON.parse(readFileSync(s.settingsPath(), 'utf8'))
    expect(file).toMatchObject({ version: 1, holdMode: 'key', stepMs: 250 })
  })

  it('битый файл переименовывается в .bak, настройки по умолчанию', async () => {
    const s = await load()
    writeFileSync(s.settingsPath(), '{не json')
    expect(s.loadSettings().stepMs).toBe(100)
    expect(existsSync(`${s.settingsPath()}.bak`)).toBe(true)
  })

  it('мусор от рендерера не попадает в файл', async () => {
    const s = await load()
    const saved = s.saveSettings({ stepMs: -5, holdMode: 'rm -rf', color: 'javascript:alert(1)', extra: 'x' })
    expect(saved).toMatchObject({ stepMs: 1, holdMode: 'timer', color: '#ff3b30' })
    expect(saved).not.toHaveProperty('extra')
    s.flushSettings()
    expect(JSON.parse(readFileSync(s.settingsPath(), 'utf8'))).not.toHaveProperty('extra')
  })
})
