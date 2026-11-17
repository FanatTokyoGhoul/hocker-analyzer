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
  onUpdateShape(shape: Shape): void
  onDeleteShape(id: string): void
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
  const { info, videoRef, shapes, canDraw, tool, color, onAddShape, onUpdateShape, onDeleteShape, onDrawStart, onDropFile, onVideoError, onClickVideo, hint, overlay, floating, empty, zoom, onZoom } = props
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
  // увеличение двумя пальцами (когда не рисуем): между событиями React может не успеть перерисовать —
  // последнее значение зума держим в ref
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; x: number; y: number } | null>(null)
  const pinchState = (): { dist: number; x: number; y: number } => {
    const [a, b] = [...touches.current.values()]
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }
  const dropTouch = (id: number): void => {
    touches.current.delete(id)
    // любой поднятый палец заканчивает щипок: иначе следующая пара считается от старой и зум прыгает
    pinch.current = null
  }
  // кадр сменился посреди касания (переключили видео) — старые пальцы не должны превращать тап в щипок
  useEffect(() => {
    touches.current.clear()
    pinch.current = null
  }, [info])
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
            if (e.pointerType === 'touch' && !drawingActive) {
              touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
              // захват — только для щипка: захваченный одиночный тап не дойдёт до <video> кликом (пауза)
              if (touches.current.size === 2) {
                for (const id of touches.current.keys()) {
                  if (e.currentTarget.hasPointerCapture(id)) continue
                  try {
                    e.currentTarget.setPointerCapture(id)
                  } catch {
                    // палец уже отпустили
                  }
                }
                pan.current = null
                pinch.current = pinchState()
                return
              }
            }
            if (zoom.z <= 1 || !(e.button === 1 || (e.button === 0 && !drawingActive))) return
            e.currentTarget.setPointerCapture(e.pointerId)
            pan.current = { x: e.clientX, y: e.clientY, moved: false }
          }}
          onPointerMove={(e) => {
            if (pinch.current && touches.current.has(e.pointerId)) {
              touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
              const prev = pinch.current
              const next = pinchState()
              const rect = e.currentTarget.getBoundingClientRect()
              if (prev.dist > 0 && rect.width > 0) {
                const zoomed = zoomAt(zoomRef.current, next.dist / prev.dist, (next.x - rect.left) / rect.width, (next.y - rect.top) / rect.height)
                zoomRef.current = panBy(zoomed, (next.x - prev.x) / rect.width, (next.y - prev.y) / rect.height)
                onZoom(zoomRef.current)
              }
              pinch.current = next
              suppressClick.current = true
              return
            }
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
          onPointerUp={(e) => {
            const pinched = touches.current.size >= 2
            dropTouch(e.pointerId)
            suppressClick.current = pinched || suppressClick.current || !!pan.current?.moved
            pan.current = null
          }}
          onLostPointerCapture={(e) => dropTouch(e.pointerId)}
          onPointerCancel={(e) => {
            dropTouch(e.pointerId)
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
              onUpdate={onUpdateShape}
              onDelete={onDeleteShape}
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
