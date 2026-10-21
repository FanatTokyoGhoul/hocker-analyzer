import { describe, expect, it } from 'vitest'
import type { Moment, ProjectVideo } from '../../../shared/types'
import { momentsCsv, normalizePeriods, periodOf, statsCsv, tagStats } from './stats'

const moment = (id: string, start: number, end: number, extra: Partial<Moment> = {}): Moment => ({ id, title: id, start, end, ...extra })
const video = (id: string, offset: number): ProjectVideo => ({ id, path: `/${id}.mp4`, label: `В-${id}`, offset, fps: 25 })

describe('periodOf', () => {
  it('без периодов — первый', () => {
    expect(periodOf(100, undefined)).toBe(1)
    expect(periodOf(100, [])).toBe(1)
  })
  it('граница относится к следующему периоду', () => {
    expect(periodOf(59.9, [60, 120])).toBe(1)
    expect(periodOf(60, [60, 120])).toBe(2)
    expect(periodOf(500, [60, 120])).toBe(3)
  })
})

describe('normalizePeriods', () => {
  it('убирает мусор, сортирует и убирает повторы', () => {
    expect(normalizePeriods([120, NaN, 0, -5, 60, 120, Infinity])).toEqual([60, 120])
  })
})

describe('tagStats', () => {
  const moments = [
    moment('a', 10, 20, { tags: ['гол', 'бросок'] }),
    moment('b', 70, 75, { tags: ['гол'] }),
    moment('c', 80, 90)
  ]
  it('считает по тегам, без тега и итог; момент с двумя тегами — один раз в итоге', () => {
    const rows = tagStats(moments, [60])
    expect(rows.map((r) => [r.label, r.count, r.duration, r.perPeriod])).toEqual([
      ['бросок', 1, 10, [1, 0]],
      ['гол', 2, 15, [1, 1]],
      ['без тега', 1, 10, [0, 1]],
      ['Всего', 3, 25, [1, 2]]
    ])
    expect(rows[3].kind).toBe('total')
  })
  it('пустой список — только итог с одним периодом', () => {
    const rows = tagStats([], undefined)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'total', count: 0, perPeriod: [0] })
  })
  it('без моментов без тегов строки «без тега» нет', () => {
    expect(tagStats([moment('a', 0, 1, { tags: ['x'] })], []).map((r) => r.kind)).toEqual(['tag', 'total'])
  })
})

describe('momentsCsv', () => {
  it('BOM, CRLF, разделитель ;, десятичная запятая', () => {
    const csv = momentsCsv([moment('a', 10, 22.5, { tags: ['гол', 'бросок'], notes: 'x', drawings: [{ time: 1, shapes: [{ id: 's', kind: 'line', points: [0, 0, 1, 1], color: '#f00' }] }] })], [video('1', 0)], [])
    expect(csv.startsWith('﻿№;Название;Теги;Начало;Конец;Длительность, с;Период;Видео;Заметки;Рисунков\r\n')).toBe(true)
    expect(csv).toContain('1;a;гол, бросок;0:10.000;0:22.500;12,5;1;В-1;x;1\r\n')
    expect(csv.endsWith('\r\n')).toBe(true)
  })
  it('экранирует кавычки, разделители, переводы строк', () => {
    const csv = momentsCsv([moment('a', 0, 1, { title: 'a;"b"', notes: 'л1\nл2' })], [], undefined)
    expect(csv).toContain('"a;""b"""')
    expect(csv).toContain('"л1\nл2"')
  })
  it('нейтрализует формулы, спрятанные за табуляцией', () => {
    const csv = momentsCsv([moment('\t=cmd', 0, 1)], [], undefined)
    expect(csv).toContain(`"'\t=cmd"`)
  })

  it('нейтрализует формулы', () => {
    const csv = momentsCsv([moment('=1+1', 0, 1, { tags: ['@x'], notes: '-5' })], [], undefined)
    expect(csv).toContain("'=1+1;'@x;")
    expect(csv).toContain("'-5")
  })
  it('видео: последнее начавшееся, единственное — всегда', () => {
    const vs = [video('1', 0), video('2', 100)]
    const csv = momentsCsv([moment('a', 50, 51), moment('b', 150, 151)], vs, [100])
    expect(csv).toContain(';1;В-1;')
    expect(csv).toContain(';2;В-2;')
    expect(momentsCsv([moment('a', 5, 6)], [video('1', 10)], []).split('\r\n')[1]).toContain(';В-1;')
    expect(momentsCsv([moment('a', 5, 6)], [video('1', 10), video('2', 20)], []).split('\r\n')[1]).not.toContain('В-')
  })
})

describe('statsCsv', () => {
  it('заголовок по числу периодов и итоговая строка', () => {
    const csv = statsCsv(tagStats([moment('a', 0, 12.5, { tags: ['гол'] })], [60]), 2)
    expect(csv).toBe('﻿Тег;Всего;П1;П2;Время, с\r\nгол;1;1;0;12,5\r\nВсего;1;1;0;12,5\r\n')
  })
})
