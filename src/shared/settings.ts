/** Настройки, которые обычно задают один раз. Хранятся в settings.json в профиле приложения (см. main/settings.ts). */

export type HoldMode = 'off' | 'key' | 'timer'
export type HoldScope = 'playlist' | 'always'

/** Кнопка быстрой разметки: одно нажатие (или Shift+цифра) — момент [t − before, t + after] с тегом. */
export type QuickTag = {
  id: string
  label: string
  tag: string
  before: number
  after: number
}

export const MAX_QUICK_TAGS = 9

export type Settings = {
  stepMs: number
  /** Что делать на кадре с рисунком: не останавливаться, ждать клавишу или N секунд. */
  holdMode: HoldMode
  holdSeconds: number
  /** Останавливаться только в «Проиграть все» или при любом воспроизведении. */
  holdScope: HoldScope
  color: string
  recentColors: string[]
  quickTags: QuickTag[]
}

export const PRESET_COLORS = ['#ff3b30', '#ff9500', '#ffd60a', '#30d158', '#0a84ff', '#bf5af2', '#ffffff', '#111111']
export const MAX_RECENT_COLORS = 8

const qt = (id: string, label: string, tag: string, before = 5, after = 3): QuickTag => ({ id, label, tag, before, after })

export const DEFAULT_QUICK_TAGS: QuickTag[] = [
  qt('q-goal', 'Гол', 'гол', 8, 3),
  qt('q-shot', 'Бросок', 'бросок', 5, 2),
  qt('q-loss', 'Потеря', 'потеря', 5, 3),
  qt('q-steal', 'Отбор', 'отбор', 4, 3),
  qt('q-faceoff', 'Вбрасывание', 'вбрасывание', 2, 5),
  qt('q-pp', 'Большинство', 'большинство', 5, 10)
]

export const DEFAULT_SETTINGS: Settings = {
  stepMs: 100,
  holdMode: 'timer',
  holdSeconds: 3,
  holdScope: 'always',
  color: PRESET_COLORS[0],
  recentColors: [],
  quickTags: DEFAULT_QUICK_TAGS
}

const HEX = /^#[0-9a-f]{6}$/i

/** '#ABC' / 'abc' / '#aabbcc' → '#aabbcc'; иначе null. */
export function normalizeHex(input: string): string | null {
  let v = input.trim().toLowerCase()
  if (!v.startsWith('#')) v = `#${v}`
  if (/^#[0-9a-f]{3}$/.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
  return HEX.test(v) ? v : null
}

/** Добавляет цвет в начало списка недавних (без повторов и пресетов). */
export function pushRecentColor(recent: string[], color: string): string[] {
  const c = normalizeHex(color)
  if (!c || PRESET_COLORS.includes(c)) return recent
  return [c, ...recent.filter((r) => r !== c)].slice(0, MAX_RECENT_COLORS)
}

const num = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback

/** Приводит сохранённое значение (любой формат, в т.ч. старые версии) к корректным настройкам. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS
  return {
    stepMs: Math.round(num(r.stepMs, 1, 60000, d.stepMs)),
    holdMode: r.holdMode === 'off' || r.holdMode === 'key' || r.holdMode === 'timer' ? r.holdMode : d.holdMode,
    holdSeconds: Math.round(num(r.holdSeconds, 0.5, 60, d.holdSeconds) * 10) / 10,
    holdScope: r.holdScope === 'playlist' || r.holdScope === 'always' ? r.holdScope : d.holdScope,
    color: (typeof r.color === 'string' && normalizeHex(r.color)) || d.color,
    recentColors: Array.isArray(r.recentColors)
      ? [...new Set(r.recentColors.filter((c): c is string => typeof c === 'string').map(normalizeHex).filter((c): c is string => !!c))].slice(
          0,
          MAX_RECENT_COLORS
        )
      : [],
    quickTags: Array.isArray(r.quickTags) ? sanitizeQuickTags(r.quickTags) : d.quickTags
  }
}

function sanitizeQuickTags(raw: unknown[]): QuickTag[] {
  const seen = new Set<string>()
  const out: QuickTag[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const q = item as Record<string, unknown>
    const label = typeof q.label === 'string' ? q.label.trim().slice(0, 40) : ''
    if (!label) continue
    let id = typeof q.id === 'string' && q.id ? q.id.slice(0, 40) : `q-${out.length}`
    while (seen.has(id)) id += '_'
    seen.add(id)
    const tag = typeof q.tag === 'string' ? q.tag.trim().slice(0, 40) : ''
    out.push({
      id,
      label,
      tag: tag || label.toLowerCase(),
      before: Math.round(num(q.before, 0, 120, 5) * 10) / 10,
      after: Math.round(num(q.after, 0, 120, 3) * 10) / 10
    })
    if (out.length === MAX_QUICK_TAGS) break
  }
  return out
}
