import { describe, expect, it } from 'vitest'
import { PROGRESS_MARK, ProgressTracker, checksumFor, errorFromStderr, isPostprocessLine, parseProgressLine, plannedFormats, ytDlpAsset } from './ytdlpParse'

describe('ytdlpParse', () => {
  it('выбирает сборку yt-dlp под платформу', () => {
    expect(ytDlpAsset('linux', 'x64')).toBe('yt-dlp_linux')
    expect(ytDlpAsset('linux', 'arm64')).toBe('yt-dlp_linux_aarch64')
    expect(ytDlpAsset('linux', 'ia32')).toBeNull()
    expect(ytDlpAsset('darwin', 'x64')).toBe('yt-dlp_macos')
    expect(ytDlpAsset('win32', 'x64')).toBe('yt-dlp.exe')
    expect(ytDlpAsset('freebsd', 'x64')).toBeNull()
  })

  it('находит контрольную сумму файла', () => {
    const h = 'a'.repeat(64)
    const sums = `${'b'.repeat(64)}  yt-dlp_linux_aarch64\n${h}  yt-dlp_linux\n${'c'.repeat(64)} *yt-dlp.exe\n`
    expect(checksumFor(sums, 'yt-dlp_linux')).toBe(h)
    expect(checksumFor(sums, 'yt-dlp.exe')).toBe('c'.repeat(64))
    expect(checksumFor(sums, 'yt-dlp_macos')).toBeNull()
  })

  it('разбирает строку прогресса', () => {
    expect(parseProgressLine(`${PROGRESS_MARK} 1048576 4194304 NA 524288.5 6 avc1.64002A dash_sep-6`)).toEqual({
      downloaded: 1048576,
      total: 4194304,
      speed: 524288.5,
      eta: 6,
      audio: false,
      formatId: 'dash_sep-6'
    })
    // точного размера нет — берём оценку; звук — vcodec none
    expect(parseProgressLine(`${PROGRESS_MARK} 100 NA 900.0 NA NA none dash_audio`)).toMatchObject({ total: 900, speed: null, eta: null, audio: true })
    expect(parseProgressLine('[download]  12.5% of 10MiB')).toBeNull()
    expect(parseProgressLine(`${PROGRESS_MARK} NA NA NA NA NA none x`)).toBeNull()
  })

  it('узнаёт склейку и понятные ошибки', () => {
    expect(isPostprocessLine('[Merger] Merging formats into "video.mp4"')).toBe(true)
    expect(isPostprocessLine('[download] Destination: video.f1.mp4')).toBe(false)
    expect(errorFromStderr('WARNING: x\nERROR: [vk] 1_2: This video is only available for registered users')).toMatch(/без входа/)
    expect(errorFromStderr('ERROR: Unsupported URL: https://vk.com/id1')).toBe('По этой ссылке нет видео')
    expect(errorFromStderr('ERROR: something odd')).toBe('something odd')
    expect(errorFromStderr('')).toBe('yt-dlp завершился с ошибкой')
  })

  it('план потоков из сведений yt-dlp', () => {
    expect(
      plannedFormats({
        requested_formats: [
          { format_id: 'v', filesize: 1000, vcodec: 'avc1' },
          { format_id: 'a', filesize_approx: 200, vcodec: 'none' }
        ]
      })
    ).toEqual([
      { formatId: 'v', size: 1000, audio: false },
      { formatId: 'a', size: 200, audio: true }
    ])
    expect(plannedFormats({ format_id: 'url720', vcodec: 'unknown' })).toEqual([{ formatId: 'url720', size: null, audio: false }])
    // размера нет — оценка по битрейту (кбит/с) и длительности
    expect(plannedFormats({ duration: 8, requested_formats: [{ format_id: 'v', tbr: 1000, vcodec: 'avc1' }] })).toEqual([{ formatId: 'v', size: 1_000_000, audio: false }])
  })

  it('общий прогресс по видео и звуку', () => {
    const t = new ProgressTracker([
      { formatId: 'v', size: 1000, audio: false },
      { formatId: 'a', size: 200, audio: true }
    ])
    expect(t.update({ downloaded: 500, total: 1000, speed: null, eta: null, audio: false, formatId: 'v' })).toEqual({ downloaded: 500, total: 1200, ratio: 500 / 1200 })
    // начался звук — видео считается скачанным целиком
    expect(t.update({ downloaded: 100, total: 200, speed: null, eta: null, audio: true, formatId: 'a' }).ratio).toBeCloseTo(1100 / 1200)
  })

  it('размер, неизвестный заранее, берётся из прогресса', () => {
    const t = new ProgressTracker([{ formatId: 'url720', size: null, audio: false }])
    expect(t.update({ downloaded: 10, total: null, speed: null, eta: null, audio: false, formatId: 'url720' }).ratio).toBeNull()
    expect(t.update({ downloaded: 50, total: 100, speed: null, eta: null, audio: false, formatId: 'url720' }).ratio).toBe(0.5)
  })
})
