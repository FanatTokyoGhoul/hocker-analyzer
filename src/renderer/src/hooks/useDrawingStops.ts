import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { findCrossedDrawing } from '../lib/drawingStops'
import type { HoldMode } from '../../../shared/settings'
import { frameIndex } from '../lib/time'

export type Hold = {
  time: number
  /** 'key' — ждём клавишу или клик; 'timer' — продолжим сами в момент until. */
  mode: Exclude<HoldMode, 'off'>
  until: number | null
  /** Длительность остановки по таймеру, мс. */
  total: number
}

export type DrawingStops = {
  hold: Hold | null
  /** Снять остановку; play — продолжить воспроизведение. */
  release(play: boolean): void
  /** Остановить таймер (начали рисовать) — дальше ждём клавишу. */
  freeze(): void
  /**
   * Вызывать перед программной перемоткой (старт плейлиста, переход к следующему моменту):
   * рисунок прямо на кадре, куда перематываем, тоже вызовет остановку. Без этого кадр
   * начала момента считался бы «уже пройденным».
   */
  arm(): void
}

type Options = { mode: HoldMode; seconds: number; enabled: boolean }

/**
 * Останавливает воспроизведение на кадрах с рисунками: до нажатия клавиши или на N секунд.
 * times — локальные времена рисунков активного видео по возрастанию (см. drawingTimes).
 * Кадры отслеживаются через requestVideoFrameCallback; срабатывает, когда воспроизведение
 * «перешагнуло» кадр рисунка, а не после перемотки.
 */
export function useDrawingStops(video: HTMLVideoElement | null, times: number[], fps: number, options: Options): DrawingStops {
  const [hold, setHold] = useState<Hold | null>(null)

  const live = useRef({ times, fps, options })
  live.current = { times, fps, options }
  const timer = useRef<number | null>(null)
  const holdRef = useRef<Hold | null>(null)
  const ownSeek = useRef(false)
  const armed = useRef(false)

  const set = useCallback((h: Hold | null) => {
    holdRef.current = h
    setHold(h)
  }, [])

  const clearTimer = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }

  const release = useCallback(
    (play: boolean) => {
      clearTimer()
      if (!holdRef.current) return
      set(null)
      if (play) void video?.play()
    },
    [video, set]
  )

  const freeze = useCallback(() => {
    const h = holdRef.current
    if (!h || h.mode === 'key') return
    clearTimer()
    set({ ...h, mode: 'key', until: null, total: 0 })
  }, [set])

  const arm = useCallback(() => {
    armed.current = true
  }, [])

  useEffect(() => {
    if (!video) return
    // последний кадр непрерывного воспроизведения; рисунки на кадрах после него вызовут остановку.
    // null — после ручной перемотки: кадр, на котором стоим, пользователь уже видит
    let prev: number | null = null
    let handle = 0
    const frameNow = (): number => frameIndex(video.currentTime, live.current.fps)

    const onPlay = (): void => {
      if (prev === null) prev = frameNow()
    }
    const onSeeking = (): void => {
      if (ownSeek.current) {
        // перемотка на кадр рисунка самой остановкой — после продолжения он не должен сработать снова
        ownSeek.current = false
        prev = frameNow()
        return
      }
      prev = armed.current ? frameNow() - 1 : null
      armed.current = false
      // пользователь сам перемотал — остановка больше не актуальна
      if (holdRef.current) release(false)
    }
    const onFrame: VideoFrameRequestCallback = (_now, meta) => {
      handle = video.requestVideoFrameCallback(onFrame)
      if (video.paused || video.seeking) return
      const { times, fps, options } = live.current
      const cur = frameIndex(meta.mediaTime, fps)
      if (prev === null) {
        prev = cur
        return
      }
      const crossed = options.enabled && options.mode !== 'off' ? findCrossedDrawing(times, prev, cur, fps) : null
      prev = cur
      if (crossed === null) return
      video.pause()
      ownSeek.current = true
      video.currentTime = crossed
      const mode = options.mode as Hold['mode']
      const total = mode === 'timer' ? options.seconds * 1000 : 0
      set({ time: crossed, mode, until: mode === 'timer' ? Date.now() + total : null, total })
      clearTimer()
      if (mode === 'timer') timer.current = window.setTimeout(() => release(true), options.seconds * 1000)
    }

    handle = video.requestVideoFrameCallback(onFrame)
    video.addEventListener('play', onPlay)
    video.addEventListener('seeking', onSeeking)
    return () => {
      video.cancelVideoFrameCallback(handle)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('seeking', onSeeking)
      clearTimer()
      ownSeek.current = false
      armed.current = false
      set(null)
    }
  }, [video, release, set])

  return useMemo(() => ({ hold, release, freeze, arm }), [hold, release, freeze, arm])
}
