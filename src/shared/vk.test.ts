import { describe, expect, it } from 'vitest'
import { normalizeVkUrl } from './vk'

describe('normalizeVkUrl', () => {
  it('принимает ссылки на видео VK и VK Видео', () => {
    expect(normalizeVkUrl('https://vkvideo.ru/video-18403220_456239696')).toBe('https://vkvideo.ru/video-18403220_456239696')
    expect(normalizeVkUrl('  vk.com/video205387401_165548505 ')).toBe('https://vk.com/video205387401_165548505')
    expect(normalizeVkUrl('http://m.vk.com/video-140332_456239111?list=abc#t=10')).toBe('https://m.vk.com/video-140332_456239111?list=abc')
    expect(normalizeVkUrl('https://vk.com/videos-77521?z=video-77521_162222515%2Fclub77521')).not.toBeNull()
    expect(normalizeVkUrl('https://vk.com/video_ext.php?oid=-77521&id=162222515&hash=87b046504ccd8bfa')).not.toBeNull()
    expect(normalizeVkUrl('https://vk.ru/clip-1_2')).toBe('https://vk.ru/clip-1_2')
  })

  it('отклоняет чужие сайты и не-видео', () => {
    expect(normalizeVkUrl('')).toBeNull()
    expect(normalizeVkUrl('https://youtube.com/watch?v=video-1_2')).toBeNull()
    expect(normalizeVkUrl('https://vk.com.evil.ru/video-1_2')).toBeNull()
    expect(normalizeVkUrl('https://evilvk.com/video-1_2')).toBeNull()
    expect(normalizeVkUrl('https://vk.com/id123')).toBeNull()
    expect(normalizeVkUrl('file:///etc/vk.com/video-1_2')).toBeNull()
    expect(normalizeVkUrl('https://user:pass@vk.com/video-1_2')).toBeNull()
    expect(normalizeVkUrl('https://vk.com:8080/video-1_2')).toBeNull()
    expect(normalizeVkUrl('https://vk.com/video-1_2 --exec rm')).toBeNull()
    expect(normalizeVkUrl('https://vk.com/%E0%A4%A')).toBeNull()
    // id видео в постороннем параметре — это переадресация, а не видео
    expect(normalizeVkUrl('https://vk.com/away.php?to=https://evil.example/x&v=video1_2')).toBeNull()
    expect(normalizeVkUrl('https://vk.com/video_ext.php?to=x')).toBeNull()
  })
})
