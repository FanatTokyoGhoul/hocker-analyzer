import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Shape, VideoInfo } from '../../../shared/types'
import { NO_ZOOM, fitContain, panBy, zoomAt, type ZoomView } from '../lib/geometry'
import { DrawingLayer, type Tool } from './DrawingLayer'

type Props = {
  info: VideoInfo | null
  videoRef(el: HTMLVideoElement | null): void
  shapes: Shape[]
  canDraw: boolean
  tool: Tool
  color: string
  onAddShape(shape: Shape): void
  onDrawStart(): void
  onDropFile(file: File): void
  onVideoError(): void
  onClickVideo(): void
  hint: string | null
  overlay: ReactNode
  /** Плавающие элементы поверх видео (меню рисования, плашка остановки) — только когда видео открыто. */
  floating: ReactNode
  empty: ReactNode
  zoom: ZoomView
  onZoom(v: ZoomView): void
}

export function VideoStage(props: Props): React.JSX.Element {
  const { info, videoRef, shapes, canDraw, tool, color, onAddShape, onDrawStart, onDropFile, onVideoError, onClickVideo, hint, overlay, floating, empty, zoom, onZoom } = props
  const boxRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setBox({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const aspect = info && info.width && info.height ? info.width / info.height : 16 / 9
  const size = fitContain(box, aspect)

  // перетаскивание увеличенного кадра: средней кнопкой всегда, левой — когда не рисуем.
  // После перетаскивания клик не должен ставить видео на паузу
  const pan = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const drawingActive = canDraw && tool !== 'none'
  const onWheel = (e: React.WheelEvent<HTMLDivElement>): void => {
    if (size.width <= 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const factor = Math.exp(-e.deltaY * 0.0015)
    onZoom(zoomAt(zoom, factor, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height))
  }

  return (
    <div
      ref={boxRef}
      className={`stage${dragOver ? ' is-dragover' : ''}`}
      onPointerDown={() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const file = e.dataTransfer.files[0]
        if (file) onDropFile(file)
      }}
    >
      {info ? (
        <div
          className={`stage-frame${zoom.z > 1 ? ' is-zoomed' : ''}`}
          style={{ width: size.width, height: size.height }}
          onWheel={onWheel}
          onPointerDown={(e) => {
            suppressClick.current = false
            if (zoom.z <= 1 || !(e.button === 1 || (e.button === 0 && !drawingActive))) return
            e.currentTarget.setPointerCapture(e.pointerId)
            pan.current = { x: e.clientX, y: e.clientY, moved: false }
          }}
          onPointerMove={(e) => {
            const p = pan.current
            if (!p || size.width <= 0) return
            const dx = e.clientX - p.x
            const dy = e.clientY - p.y
            if (!p.moved && Math.hypot(dx, dy) < 4) return
            p.moved = true
            p.x = e.clientX
            p.y = e.clientY
            onZoom(panBy(zoom, dx / size.width, dy / size.height))
          }}
          onPointerUp={() => {
            suppressClick.current = !!pan.current?.moved
            pan.current = null
          }}
          onPointerCancel={() => {
            pan.current = null
            suppressClick.current = false
          }}
        >
          <div
            className="stage-zoom"
            style={zoom.z > 1 ? { transform: `translate(${zoom.tx * size.width}px, ${zoom.ty * size.height}px) scale(${zoom.z})` } : undefined}
          >
          <video
            ref={videoRef}
            key={info.url}
            src={info.url}
            preload="auto"
            onError={onVideoError}
            onClick={() => {
              if (suppressClick.current) suppressClick.current = false
              else onClickVideo()
            }}
          />
          {size.width > 0 && (
            <DrawingLayer
              width={size.width}
              height={size.height}
              shapes={shapes}
              editable={canDraw}
              tool={tool}
              color={color}
              onAdd={onAddShape}
              onDrawStart={onDrawStart}
            />
          )}
          </div>
          {hint && <div className="stage-hint">{hint}</div>}
          {zoom.z > 1 && (
            <button type="button" className="zoom-badge" title="Сбросить увеличение (0)" onPointerDown={(e) => e.stopPropagation()} onClick={() => onZoom(NO_ZOOM)}>
              ×{zoom.z.toFixed(1)} ⟲
            </button>
          )}
        </div>
      ) : (
        empty
      )}
      {info && floating}
      {overlay}
    </div>
  )
}
