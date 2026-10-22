import { describe, expect, it } from 'vitest'
import { errorText } from './errors'

describe('errorText', () => {
  it('убирает префикс IPC', () => {
    expect(errorText(new Error("Error invoking remote method 'video:probe': Error: нет файла"))).toBe('нет файла')
    expect(errorText('просто строка')).toBe('просто строка')
    expect(errorText(new Error("Error invoking remote method 'x': без префикса Error"))).toBe('без префикса Error')
    expect(errorText({ message: 'из объекта' })).toBe('из объекта')
  })
})
