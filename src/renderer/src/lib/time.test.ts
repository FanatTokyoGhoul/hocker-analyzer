import { describe, expect, it } from 'vitest'
import { clampRate, formatTime, frameIndex, parseTime, stepFrameTime, stepMsTime } from './time'

describe('шаг по кадрам', () => {
  it('переходит на следующий и предыдущий кадр, ставя середину кадра', () => {
    expect(stepFrameTime(1, 25, 1, 60)).toBeCloseTo(26.5 / 25)
    expect(stepFrameTime(1, 25, -1, 60)).toBeCloseTo(24.5 / 25)
  })

  it('повторные шаги накапливаются ровно на один кадр', () => {
    let t = 0
    for (let i = 0; i < 300; i++) t = stepFrameTime(t, 29.97, 1, 60)
    expect(frameIndex(t, 29.97)).toBe(300)
  })

  it('не выходит за начало и конец видео', () => {
    expect(stepFrameTime(0, 30, -1, 10)).toBeCloseTo(0.5 / 30)
    expect(frameIndex(stepFrameTime(9.99, 30, 5, 10), 30)).toBe(299)
  })

  it('шаг на N мс с ограничением', () => {
    expect(stepMsTime(1, 100, 10)).toBeCloseTo(1.1)
    expect(stepMsTime(0.05, -100, 10)).toBe(0)
    expect(stepMsTime(9.95, 100, 10)).toBe(10)
  })
})

describe('скорость', () => {
  it('держится в пределах 0.1–1', () => {
    expect(clampRate(0.01)).toBe(0.1)
    expect(clampRate(2)).toBe(1)
    expect(clampRate(0.333)).toBe(0.33)
  })
})

describe('формат времени', () => {
  it('форматирует и разбирает', () => {
    expect(formatTime(78)).toBe('1:18.000')
    expect(formatTime(3683.25)).toBe('1:01:23.250')
    expect(formatTime(85, false)).toBe('1:25')
    expect(parseTime('1:18')).toBe(78)
    expect(parseTime('1:01:23,5')).toBe(3683.5)
    expect(parseTime('12.5')).toBe(12.5)
    expect(parseTime('abc')).toBeNull()
    expect(parseTime('1::2')).toBeNull()
  })
})
