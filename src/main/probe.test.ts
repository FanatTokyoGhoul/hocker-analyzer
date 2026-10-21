import { describe, expect, it } from 'vitest'
import { parseFrameRate, parseProgressTime, summarizeProbe } from './probe'
import { parseRange } from './media'

describe('ffprobe', () => {
  it('разбирает частоту кадров', () => {
    expect(parseFrameRate('30000/1001')).toBeCloseTo(29.97, 2)
    expect(parseFrameRate('25/1')).toBe(25)
    expect(parseFrameRate('0/0')).toBeNull()
    expect(parseFrameRate(undefined)).toBeNull()
  })

  it('требует конвертацию для HEVC и H.264 10 bit, но не для обычного H.264', () => {
    const json = (codec: string, profile = 'High', audio = 'aac') => ({
      streams: [
        { codec_type: 'video', codec_name: codec, profile, width: 1920, height: 1080, avg_frame_rate: '60/1' },
        { codec_type: 'audio', codec_name: audio }
      ],
      format: { duration: '3600.5' }
    })
    expect(summarizeProbe(json('h264'))).toMatchObject({ fps: 60, duration: 3600.5, needsConversion: false })
    expect(summarizeProbe(json('hevc', 'Main'))).toMatchObject({ needsConversion: true })
    expect(summarizeProbe(json('h264', 'High 10'))).toMatchObject({ needsConversion: true })
    expect(summarizeProbe(json('h264', 'High', 'ac3'))).toMatchObject({ needsConversion: true })
    expect(() => summarizeProbe({ streams: [{ codec_type: 'audio' }] })).toThrow()
  })

  it('читает прогресс ffmpeg', () => {
    expect(parseProgressTime('frame=10\nout_time_us=1500000\nout_time_ms=2500000\nprogress=continue\n')).toBe(2.5)
    expect(parseProgressTime('frame=10\n')).toBeNull()
  })
})

describe('Range', () => {
  it('разбирает диапазоны', () => {
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=10-20', 100)).toEqual({ start: 10, end: 20 })
    expect(parseRange('bytes=90-200', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=100-', 100)).toBeNull()
    expect(parseRange('items=0-1', 100)).toBeNull()
  })
})

describe('переменная частота кадров', () => {
  it('отмечает VFR, когда avg_frame_rate расходится с r_frame_rate', () => {
    const json = (avg: string, r: string) => ({ streams: [{ codec_type: 'video', codec_name: 'h264', avg_frame_rate: avg, r_frame_rate: r }] })
    expect(summarizeProbe(json('88920000/2971379', '30/1'))).toMatchObject({ variableFrameRate: true })
    expect(summarizeProbe(json('30000/1001', '30000/1001'))).toMatchObject({ variableFrameRate: false })
  })
})
