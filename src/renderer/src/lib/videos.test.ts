import { describe, expect, it } from 'vitest'
import type { ProjectVideo } from '../../../shared/types'
import { angleLabel, continuationOffset, nextPeriodLabel, locateMoment, locateTime, syncOffset, videoCovers } from './videos'

const v = (id: string, offset: number, duration?: number): ProjectVideo => ({ id, path: `/${id}`, label: id, offset, fps: 30, duration })

describe('несколько видео', () => {
  const p1 = v('p1', 0, 1200)
  const p2 = v('p2', 1200, 1200)
  const cam = v('cam', 5, 2000)

  it('videoCovers', () => {
    expect(videoCovers(p1, 0)).toBe(true)
    expect(videoCovers(p1, 1201)).toBe(false)
    expect(videoCovers(v('x', 10), 1e6)).toBe(true)
    expect(videoCovers(p2, 1199)).toBe(false)
  })

  it('периоды подряд: время уходит в следующее видео', () => {
    expect(locateTime([p1, p2], 100, 'p1')!.id).toBe('p1')
    expect(locateTime([p1, p2], 1300, 'p1')!.id).toBe('p2')
    expect(locateTime([p1, p2], 5000, 'p1')).toBeNull()
  })

  it('ракурсы: остаёмся на активном, если он покрывает время', () => {
    expect(locateTime([p1, cam], 100, 'cam')!.id).toBe('cam')
    expect(locateTime([p1, cam], 100, 'p1')!.id).toBe('p1')
    expect(locateTime([p1, cam], 1500, 'p1')!.id).toBe('cam')
  })

  it('момент на стыке периодов относится к следующему видео', () => {
    expect(locateTime([p1, p2], 1200, 'p1')!.id).toBe('p1')
    expect(locateMoment([p1, p2], { start: 1200, end: 1207 }, 'p1')!.id).toBe('p2')
  })

  it('названия новых видео считают свои номера', () => {
    expect(nextPeriodLabel([v('Видео 1', 0)])).toBe('Период 2')
    expect(angleLabel([v('Видео 1', 0), { ...v('x', 0), label: 'Период 2' }])).toBe('Камера 2')
    expect(nextPeriodLabel([v('a', 0), { ...v('b', 0), label: 'Период 2' }, { ...v('c', 0), label: 'Камера 2' }])).toBe('Период 3')
  })

  it('сдвиг продолжения и синхронизация', () => {
    expect(continuationOffset([p1])).toBe(1200)
    expect(continuationOffset([p1, p2])).toBe(2400)
    // вбрасывание: в p1 на 65 с, в камере — на 60 с
    expect(syncOffset(p1, 65, 60)).toBe(5)
    expect(syncOffset(p1, 1, 60)).toBe(-59)
  })
})
