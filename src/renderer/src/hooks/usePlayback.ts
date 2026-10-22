import { useCallback } from 'react'
import { clampRate, stepFrameTime, stepMsTime } from '../lib/time'
import type { Hold } from './useDrawingStops'

type Options = {
  video: HTMLVideoElement | null
  stopPlaylist(): void
  /** Текущая остановка на рисунке и как её снять (Space продолжает просмотр). */
  hold: Hold | null
  release(play: boolean): void
  fps: number
  duration: number
  stepMs: number
}

/** Управление <video>: пауза, шаг на кадр и на N мс, скорость. Ручная перемотка выключает «проиграть все». */
export function usePlayback({ video, stopPlaylist, hold, release, fps, duration, stepMs }: Options) {
  /** t — время активного видео. */
  const seek = useCallback(
    (t: number) => {
      if (!video) return
      stopPlaylist()
      video.currentTime = t
    },
    [video, stopPlaylist]
  )

  const togglePlay = useCallback(() => {
    if (!video) return
    if (hold) return release(true)
    if (video.paused) void video.play()
    else video.pause()
  }, [video, hold, release])

  const stepFrame = useCallback(
    (delta: number) => {
      if (!video) return
      video.pause()
      seek(stepFrameTime(video.currentTime, fps, delta, duration))
    },
    [video, fps, duration, seek]
  )

  const stepBy = useCallback(
    (sign: 1 | -1) => {
      if (video) seek(stepMsTime(video.currentTime, sign * stepMs, duration))
    },
    [video, stepMs, duration, seek]
  )

  const setRate = useCallback(
    (r: number) => {
      if (video) video.playbackRate = clampRate(r)
    },
    [video]
  )

  return { seek, togglePlay, stepFrame, stepBy, setRate }
}
