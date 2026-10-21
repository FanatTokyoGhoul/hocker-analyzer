import { useEffect, useState } from 'react'

export type VideoClock = { time: number; paused: boolean; rate: number; duration: number }

const INITIAL: VideoClock = { time: 0, paused: true, rate: 1, duration: 0 }

/** Состояние <video>, обновляемое на каждом показанном кадре через requestVideoFrameCallback. */
export function useVideoClock(video: HTMLVideoElement | null): VideoClock {
  const [clock, setClock] = useState(INITIAL)

  useEffect(() => {
    if (!video) return
    const read = (time = video.currentTime): void =>
      setClock((prev) => {
        const next = {
          time,
          paused: video.paused,
          rate: video.playbackRate,
          duration: Number.isFinite(video.duration) ? video.duration : 0
        }
        return prev.time === next.time && prev.paused === next.paused && prev.rate === next.rate && prev.duration === next.duration
          ? prev
          : next
      })

    let handle = 0
    const onFrame: VideoFrameRequestCallback = (_now, meta) => {
      // mediaTime — время реально показанного кадра; на паузе берём currentTime (цель последнего seek)
      read(video.paused ? video.currentTime : meta.mediaTime)
      handle = video.requestVideoFrameCallback(onFrame)
    }
    handle = video.requestVideoFrameCallback(onFrame)

    const onEvent = (): void => read()
    const events = ['play', 'pause', 'seeking', 'seeked', 'ratechange', 'loadedmetadata', 'durationchange', 'emptied', 'ended']
    events.forEach((e) => video.addEventListener(e, onEvent))
    read()
    return () => {
      video.cancelVideoFrameCallback(handle)
      events.forEach((e) => video.removeEventListener(e, onEvent))
    }
  }, [video])

  return clock
}
