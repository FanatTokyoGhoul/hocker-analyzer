import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Превью кадра для подсказки над таймлайном: отдельный скрытый <video> с тем же файлом.
 * Перематывается всегда к последнему запрошенному времени и по одной перемотке за раз —
 * быстрое движение мыши не копит очередь. Плеер создаётся при первом наведении и
 * освобождается при смене файла.
 */
export function useFramePreview(src: string | null): {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  show(time: number): void
  /** Файл не читается (не найден, нужна конвертация) — показываем только время. */
  failed: boolean
} {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)
  const video = useRef<HTMLVideoElement | null>(null)
  const target = useRef<number | null>(null)
  const busy = useRef(false)

  useEffect(
    () => () => {
      const v = video.current
      video.current = null
      target.current = null
      busy.current = false
      setFailed(false)
      if (v) {
        v.removeAttribute('src')
        v.load()
      }
    },
    [src]
  )

  const draw = (v: HTMLVideoElement): void => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !v.videoWidth) return
    // высоту подгоняем под пропорции видео, ширина задана вёрсткой
    const height = Math.round((canvas.width * v.videoHeight) / v.videoWidth)
    if (canvas.height !== height) canvas.height = height
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
  }

  const seekNext = useCallback((v: HTMLVideoElement): void => {
    const t = target.current
    if (t === null || v.readyState < 1) {
      busy.current = false
      return
    }
    busy.current = true
    target.current = null
    v.currentTime = t
  }, [])

  const show = useCallback(
    (time: number) => {
      if (!src) return
      target.current = time
      let v = video.current
      if (!v) {
        v = document.createElement('video')
        v.muted = true
        // нужен только кадр под курсором, а не весь матч заранее
        v.preload = 'metadata'
        v.src = src
        const el = v
        el.addEventListener('loadedmetadata', () => seekNext(el))
        el.addEventListener('error', () => {
          if (video.current !== el) return
          busy.current = false
          setFailed(true)
        })
        el.addEventListener('seeked', () => {
          if (video.current !== el) return
          draw(el)
          seekNext(el)
        })
        video.current = v
        return
      }
      if (!busy.current) seekNext(v)
    },
    [src, seekNext]
  )

  return { canvasRef, show, failed }
}
