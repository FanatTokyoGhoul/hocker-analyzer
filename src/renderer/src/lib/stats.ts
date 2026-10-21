import type { Moment, ProjectVideo } from '../../../shared/types'
import { formatTime } from './time'
import { collectTags } from './projectState'
import { locateMoment } from './videos'

/** Номер периода (с 1) для времени проекта: periods — начала 2-го, 3-го … периодов. */
export function periodOf(time: number, periods: number[] | undefined): number {
  let n = 1
  for (const p of periods ?? []) if (time >= p) n++
  return n
}

/** Только конечные положительные значения, по возрастанию, без повторов. */
export function normalizePeriods(periods: number[]): number[] {
  return [...new Set(periods.filter((p) => Number.isFinite(p) && p > 0))].sort((a, b) => a - b)
}

export type StatsRow = {
  kind: 'tag' | 'none' | 'total'
  /** Тег или подпись строки. */
  label: string
  count: number
  /** Суммарная длительность, секунды. */
  duration: number
  /** Количество моментов по периодам; длина = число периодов. */
  perPeriod: number[]
}

export const NO_TAG_LABEL = 'без тега'
export const TOTAL_LABEL = 'Всего'

/** Строки статистики: по тегу, «без тега» (если есть такие моменты) и итог. Начало момента определяет период. */
export function tagStats(moments: Moment[], periods: number[] | undefined): StatsRow[] {
  const ps = normalizePeriods(periods ?? [])
  const n = ps.length + 1
  const empty = (kind: StatsRow['kind'], label: string): StatsRow => ({ kind, label, count: 0, duration: 0, perPeriod: new Array(n).fill(0) })
  const add = (row: StatsRow, m: Moment, period: number): void => {
    row.count++
    row.duration += Math.max(0, m.end - m.start)
    row.perPeriod[period - 1]++
  }
  const byTag = new Map(collectTags(moments).map((t) => [t, empty('tag', t)]))
  const none = empty('none', NO_TAG_LABEL)
  const total = empty('total', TOTAL_LABEL)
  for (const m of moments) {
    const period = periodOf(m.start, ps)
    add(total, m, period)
    const tags = [...new Set(m.tags ?? [])]
    if (tags.length === 0) add(none, m, period)
    for (const t of tags) add(byTag.get(t)!, m, period)
  }
  return [...byTag.values(), ...(none.count > 0 ? [none] : []), total]
}

const BOM = '﻿'

/** Текстовое поле CSV: защита от формул (=, +, -, @, а также табуляция и CR в начале) и экранирование. */
function textField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[;"\r\n\t]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Число с десятичной запятой (для русского Excel), до 3 знаков. */
function numberField(value: number): string {
  return String(Math.round(value * 1000) / 1000).replace('.', ',')
}

function toCsv(rows: string[][]): string {
  return BOM + rows.map((r) => r.join(';')).join('\r\n') + '\r\n'
}

/** Видео, в котором лежит начало момента: последнее по offset среди начавшихся к этому времени. */
/** Видео момента — по тем же правилам, что при просмотре и экспорте; единственное видео — всегда оно. */
function videoLabelOf(videos: ProjectVideo[], m: Moment): string {
  return (locateMoment(videos, m) ?? (videos.length === 1 ? videos[0] : null))?.label ?? ''
}

export function momentsCsv(moments: Moment[], videos: ProjectVideo[], periods: number[] | undefined): string {
  const starts = normalizePeriods(periods ?? [])
  const header = ['№', 'Название', 'Теги', 'Начало', 'Конец', 'Длительность, с', 'Период', 'Видео', 'Заметки', 'Рисунков'].map(textField)
  const rows = moments.map((m, i) => [
    String(i + 1),
    textField(m.title),
    textField((m.tags ?? []).join(', ')),
    formatTime(m.start),
    formatTime(m.end),
    numberField(Math.max(0, m.end - m.start)),
    String(periodOf(m.start, starts)),
    textField(videoLabelOf(videos, m)),
    textField(m.notes ?? ''),
    String((m.drawings ?? []).reduce((s, d) => s + d.shapes.length, 0))
  ])
  return toCsv([header, ...rows])
}

export function statsCsv(rows: StatsRow[], periodCount: number): string {
  const n = Math.max(1, periodCount)
  const header = ['Тег', 'Всего', ...Array.from({ length: n }, (_, i) => `П${i + 1}`), 'Время, с'].map(textField)
  const body = rows.map((r) => [
    textField(r.label),
    String(r.count),
    ...Array.from({ length: n }, (_, i) => String(r.perPeriod[i] ?? 0)),
    numberField(r.duration)
  ])
  return toCsv([header, ...body])
}
