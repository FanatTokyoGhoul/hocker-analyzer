import { describe, expect, it } from 'vitest'
import { DEFAULT_QUICK_TAGS, DEFAULT_SETTINGS, MAX_RECENT_COLORS, normalizeHex, pushRecentColor, sanitizeSettings } from './settings'

describe('настройки', () => {
  it('пустое или битое значение → настройки по умолчанию', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings('мусор')).toEqual(DEFAULT_SETTINGS)
  })

  it('ограничивает числа и отбрасывает неизвестные режимы', () => {
    const s = sanitizeSettings({ stepMs: 0, holdSeconds: 999, holdMode: 'forever', holdScope: 'x', color: 'red' })
    expect(s).toMatchObject({ stepMs: 1, holdSeconds: 60, holdMode: 'timer', holdScope: 'always', color: DEFAULT_SETTINGS.color })
  })

  it('сохраняет корректные значения', () => {
    const s = sanitizeSettings({ stepMs: 250, holdMode: 'key', holdSeconds: 1.25, holdScope: 'playlist', color: '#ABCDEF', recentColors: ['#123', 'xyz', '#112233'] })
    expect(s).toEqual({ stepMs: 250, holdMode: 'key', holdSeconds: 1.3, holdScope: 'playlist', color: '#abcdef', recentColors: ['#112233'], quickTags: DEFAULT_QUICK_TAGS })
  })
})

describe('цвета', () => {
  it('нормализует HEX', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc')
    expect(normalizeHex('ff0000')).toBe('#ff0000')
    expect(normalizeHex('#ff00')).toBeNull()
    expect(normalizeHex('rgb(1,2,3)')).toBeNull()
  })

  it('недавние цвета без повторов, без пресетов и с ограничением длины', () => {
    let r: string[] = []
    r = pushRecentColor(r, '#123456')
    r = pushRecentColor(r, '#ff3b30') // пресет — не добавляется
    r = pushRecentColor(r, '#abcdef')
    r = pushRecentColor(r, '#123456')
    expect(r).toEqual(['#123456', '#abcdef'])
    for (let i = 0; i < 20; i++) r = pushRecentColor(r, `#0000${String(i).padStart(2, '0')}`)
    expect(r).toHaveLength(MAX_RECENT_COLORS)
  })

  it('кнопки быстрой разметки: чистит, ограничивает, пустой список сохраняется', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: 'x', label: `К${i}`, tag: '', before: 999, after: -1 }))
    const q = sanitizeSettings({ quickTags: [{ label: '  ' }, 5, ...many] }).quickTags
    expect(q).toHaveLength(9)
    expect(q[0]).toEqual({ id: 'x', label: 'К0', tag: 'к0', before: 120, after: 0 })
    expect(new Set(q.map((t) => t.id)).size).toBe(9)
    expect(sanitizeSettings({ quickTags: [] }).quickTags).toEqual([])
  })
})
