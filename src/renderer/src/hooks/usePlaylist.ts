import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Moment } from '../../../shared/types'
import { decidePlaylistStep } from '../lib/playlist'

export type PlaylistView = { ids: string[]; index: number }

export type Playlist = {
  view: PlaylistView | null
  start(items: Moment[]): void
  stop(): void
}

/** Где играть момент: какое видео и его сдвиг (время видео = время проекта − offset). */
export type MomentSource = { videoId: string; offset: number }

export type PlaylistOptions = {
  /** Активное видео и его сдвиг. */
  videoId: string
  offset: number
  /** Вызывается перед каждой перемоткой плейлиста (взвод остановок на рисунках). */
  beforeSeek?(): void
  locate(m: Moment): MomentSource | null
  /** Переключить видео и, когда оно загрузится, перемотать на local и запустить. */
  switchTo(videoId: string, local: number): void
}

/**
 * «Проиграть моменты подряд»: конец отрезка ловим по кадрам через requestVideoFrameCallback.
 * Храним только id — границы читаются из актуального проекта на каждом кадре,
 * поэтому правки во время паузы сразу учитываются. Момент из другого видео — переключаемся
 * на это видео; плейлист переживает смену <video>. Остановки на рисунках — в useDrawingStops.
 */
export function usePlaylist(video: HTMLVideoElement | null, fps: number, moments: Moment[], options: PlaylistOptions): Playlist {
  const opts = useRef(options)
  opts.current = options
  const rt = useRef<PlaylistView | null>(null)
  const momentsRef = useRef(moments)
  momentsRef.current = moments
  const [view, setView] = useState<PlaylistView | null>(null)

  const publish = useCallback(() => setView(rt.current && { ...rt.current }), [])

  const stop = useCallback(() => {
    rt.current = null
    publish()
  }, [publish])

  /** Перейти к началу момента: в этом видео — перемоткой, в другом — переключением. */
  const goTo = useCallback(
    (m: Moment): boolean => {
      const src = opts.current.locate(m)
      if (!src) return false
      opts.current.beforeSeek?.()
      const local = Math.max(0, m.start - src.offset)
      if (src.videoId !== opts.current.videoId || !video) {
        opts.current.switchTo(src.videoId, local)
      } else {
        video.currentTime = local
        void video.play()
      }
      return true
    },
    [video]
  )

  /**
   * Переходит к первому моменту начиная с from, который есть в открытых видео
   * (момент вне видео пропускается, а не обрывает весь плейлист). false — играть больше нечего.
   */
  const playFrom = useCallback(
    (items: Moment[], from: number): boolean => {
      const r = rt.current
      if (!r) return false
      for (let i = from; i < items.length; i++) {
        if (goTo(items[i])) {
          r.index = r.ids.indexOf(items[i].id)
          publish()
          return true
        }
      }
      return false
    },
    [goTo, publish]
  )

  const start = useCallback(
    (items: Moment[]) => {
      if (items.length === 0) return
      rt.current = { ids: items.map((m) => m.id), index: 0 }
      if (!playFrom(items, 0)) stop()
    },
    [playFrom, stop]
  )

  const active = view !== null
  useEffect(() => {
    if (!video || !active) return
    let handle = 0
    /** Решение на текущем времени видео; Infinity — видео кончилось (момент дошёл до конца файла). */
    const step = (mediaTime: number): void => {
      const r = rt.current
      if (!r) return
      const byId = new Map(momentsRef.current.map((m) => [m.id, m]))
      const current = byId.get(r.ids[r.index])
      if (!current) {
        // текущий момент удалили — прекращаем, а не угадываем, куда перейти
        video.pause()
        stop()
        return
      }
      const live = r.ids.map((id) => byId.get(id)).filter((m): m is Moment => m !== undefined)
      const decision = decidePlaylistStep(live, live.indexOf(current), mediaTime + opts.current.offset, fps)
      if (decision.kind === 'continue') return
      if (decision.kind === 'next' && playFrom(live, decision.index)) return
      video.pause()
      stop()
    }
    const onFrame: VideoFrameRequestCallback = (_now, meta) => {
      handle = video.requestVideoFrameCallback(onFrame)
      // во время seek могут прийти кадры со старой позиции — их пропускаем
      if (!rt.current || video.seeking || video.paused) return
      step(meta.mediaTime)
    }
    // последний кадр файла бывает раньше порога конца момента — тогда переходим по событию ended
    const onEnded = (): void => step(Infinity)
    handle = video.requestVideoFrameCallback(onFrame)
    video.addEventListener('ended', onEnded)
    return () => {
      video.cancelVideoFrameCallback(handle)
      video.removeEventListener('ended', onEnded)
    }
  }, [video, active, fps, stop, playFrom])

  return useMemo(() => ({ view, start, stop }), [view, start, stop])
}
