import { describe, expect, it } from 'vitest'
import { VkError, parseVkShow, pickVkStream, vkFileName, vkVideoId } from './vkParse'

describe('vkVideoId', () => {
  it('берёт id из пути', () => {
    expect(vkVideoId('https://vk.com/video-181954286_456239425')).toBe('-181954286_456239425')
    expect(vkVideoId('https://vkvideo.ru/video205387401_164765225')).toBe('205387401_164765225')
    expect(vkVideoId('https://vk.com/clip30014565_456240946')).toBe('30014565_456240946')
  })
  it('берёт id из окна ленты (?z=) и embed-адреса', () => {
    expect(vkVideoId('https://vk.com/feed?z=video-43215063_166094326%2Fbb50cacd')).toBe('-43215063_166094326')
    expect(vkVideoId('https://vk.com/video_ext.php?oid=-181954286&id=456239425&hd=2')).toBe('-181954286_456239425')
  })
  it('отказывает чужим адресам', () => {
    expect(vkVideoId('https://example.com/video1_2')).toBeNull()
    expect(vkVideoId('https://vk.com/away.php?to=https%3A%2F%2Fevil.example%2Fvideo1_2')).toBeNull()
  })
})

/** Ответ вида payload[1] = [название, html, …, opts] — сокращённый живой пример. */
function showResponse(opts: Record<string, unknown>, code: unknown = 0): string {
  return JSON.stringify({ payload: [code, ['название', '<div/>', '', '', opts]] })
}

describe('parseVkShow', () => {
  const params = {
    md_title: 'Матч 1 период',
    url144: 'https://vkvd147.okcdn.ru/v/144.mp4?t=1',
    url480: 'https://vkvd147.okcdn.ru/v/480.mp4?t=1',
    url720: 'https://vkvd147.okcdn.ru/v/720.mp4?t=1',
    hls_fmp4: 'https://vkvd147.okcdn.ru/video.m3u8?t=2',
    jpg: 'https://iv.okcdn.ru/getVideoPreview?id=1',
    dash_sep: 'https://vkvd147.okcdn.ru/manifest.mpd?t=3'
  }

  it('достаёт потоки и название из player.params[0] и mvData', () => {
    const info = parseVkShow(showResponse({ mvData: { title: 'Матч 1 период', duration: 3600 }, player: { type: 'account', params: [params] } }))
    expect(info.title).toBe('Матч 1 период')
    expect(info.duration).toBe(3600)
    expect(info.streams.map((s) => s.quality).sort((a, b) => a - b)).toEqual([144, 480, 720, 720])
    expect(pickVkStream(info.streams)).toEqual({ url: 'https://vkvd147.okcdn.ru/v/720.mp4?t=1', quality: 720, kind: 'mp4' })
  })

  it('mp4 отсутствует — берём hls_fmp4', () => {
    const info = parseVkShow(showResponse({ mvData: { title: 'x' }, player: { params: [{ hls_fmp4: params.hls_fmp4 }] } }))
    expect(pickVkStream(info.streams)?.kind).toBe('hls')
  })

  it('код 3 — приватное видео, понятная ошибка', () => {
    expect(() => parseVkShow(JSON.stringify({ payload: ['3', ''] }))).toThrow(VkError)
    expect(() => parseVkShow(JSON.stringify({ payload: ['3', ''] }))).toThrow(/только после входа/)
  })

  it('код 8 — текст ошибки VK показывается пользователю', () => {
    expect(() => parseVkShow(JSON.stringify({ payload: ['8', ['"Видео удалено"', 'false']] }))).toThrow(/Видео удалено/)
  })

  it('не JSON — ошибка с честным текстом', () => {
    expect(() => parseVkShow('<html>login</html>')).toThrow(VkError)
  })

  it('md_title подходит, когда mvData нет', () => {
    const info = parseVkShow(showResponse({ player: { params: [params] } }))
    expect(info.title).toBe('Матч 1 период')
  })
})

describe('vkFileName', () => {
  it('чистит название и режет длину', () => {
    expect(vkFileName('Матч: «Заря» / «Труд» 1 период')).toBe('Матч «Заря» «Труд» 1 период.mp4')
    expect(vkFileName('../../etc/passwd')).toBe('etc passwd.mp4')
    expect(vkFileName(null)).toBe('Видео VK.mp4')
    expect(vkFileName('а'.repeat(500)).length).toBeLessThanOrEqual(104)
  })
})
