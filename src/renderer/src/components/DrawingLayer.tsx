import { useEffect, useMemo, useRef, useState } from 'react'
import { Layer, Stage } from 'react-konva'
import type Konva from 'konva'
import type { Shape, ZoneShape } from '../../../shared/types'
import { MAX_TEXT_LENGTH } from '../../../shared/project'
import { newId } from '../lib/ids'
import { buildRink } from '../lib/rink'
import { createShapeNode, fillDim, fillMain, textSizeFor } from '../lib/shapeRender'

export type Tool = 'none' | 'arrow' | 'pass' | 'line' | 'circle' | 'spotlight' | 'zone' | 'text' | 'freehand'

type Props = {
  width: number
  height: number
  shapes: Shape[]
  editable: boolean
  tool: Tool
  color: string
  onAdd(shape: Shape): void
  onDrawStart?(): void
  /** Фон под фигурами — схема площадки. */
  background?: 'rink'
}

const MIN_SIZE = 0.004
/** Клик ближе этого (px) к первой вершине замыкает зону. */
const CLOSE_RADIUS = 12

/** Вершины зоны без «хвоста» за курсором и без повторов (двойной клик ставит две одинаковые). */
function zoneVertices(points: number[], w: number, h: number): number[] {
  const out: number[] = []
  for (let i = 0; i < points.length; i += 2) {
    const n = out.length
    if (n && Math.hypot((points[i] - out[n - 2]) * w, (points[i + 1] - out[n - 1]) * h) < 3) continue
    out.push(points[i], points[i + 1])
  }
  return out
}

/** Canvas-слой поверх видео (или схемы): показывает фигуры и даёт рисовать новые. */
export function DrawingLayer({ width, height, shapes, editable, tool, color, onAdd, onDrawStart, background }: Props): React.JSX.Element {
  const [draft, setDraft] = useState<Shape | null>(null)
  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null)
  const [text, setText] = useState('')
  const bgLayer = useRef<Konva.Layer>(null)
  const dimLayer = useRef<Konva.Layer>(null)
  const mainLayer = useRef<Konva.Layer>(null)
  const draftLayer = useRef<Konva.Layer>(null)
  const drawing = editable && tool !== 'none'
  /** Сохранить набранную подпись (определена ниже; через ref — для эффектов). */
  const commitTextRef = useRef<() => void>(() => undefined)

  // рисование выключили посреди штриха (Space, конец паузы на рисунке, смена инструмента) — бросаем незаконченную
  // фигуру; набранную подпись сохраняем: кнопки инструментов не забирают фокус, и blur у поля не случится
  useEffect(() => {
    commitTextRef.current()
    setDraft(null)
    setTextAt(null)
  }, [drawing, tool])
  // окно схемы закрыли с открытым полем подписи
  useEffect(() => () => commitTextRef.current(), [])

  // готовые фигуры перерисовываем только при их изменении, незаконченную — в отдельном слое на каждом движении
  useEffect(() => {
    if (mainLayer.current) fillMain(mainLayer.current, shapes, width, height)
  }, [shapes, width, height])
  const spotDraft = draft?.kind === 'spotlight' ? draft : null
  const dimShapes = useMemo(() => (spotDraft ? [...shapes, spotDraft] : shapes), [shapes, spotDraft])
  useEffect(() => {
    if (dimLayer.current) fillDim(dimLayer.current, dimShapes, width, height)
  }, [dimShapes, width, height])
  useEffect(() => {
    const layer = draftLayer.current
    if (!layer) return
    layer.destroyChildren()
    if (draft) layer.add(createShapeNode(draft, width, height, { draft: draft.kind === 'zone' }))
    layer.batchDraw()
  }, [draft, width, height])

  useEffect(() => {
    const layer = bgLayer.current
    if (!layer) return
    layer.destroyChildren()
    if (background === 'rink') layer.add(buildRink(width, height))
    layer.batchDraw()
  }, [background, width, height])

  const pointer = (e: Konva.KonvaEventObject<PointerEvent | MouseEvent>): [number, number] | null => {
    const pos = e.target.getStage()?.getPointerPosition()
    return pos ? [pos.x / width, pos.y / height] : null
  }

  const commitZone = (z: ZoneShape): void => {
    const points = zoneVertices(z.points.slice(0, -2), width, height)
    if (points.length >= 6) onAdd({ ...z, points })
    setDraft(null)
  }

  // Enter и последующий blur при размонтировании поля не должны добавить подпись дважды
  const textOpen = useRef(false)
  textOpen.current = textAt !== null
  const commitText = (): void => {
    if (!textOpen.current) return
    textOpen.current = false
    const value = text.trim()
    if (textAt && value) onAdd({ id: newId('s'), kind: 'text', x: textAt.x, y: textAt.y, text: value, color })
    setTextAt(null)
    setText('')
  }
  commitTextRef.current = commitText

  const onDown = (e: Konva.KonvaEventObject<PointerEvent>): void => {
    if (!drawing || e.evt.button !== 0) return
    const p = pointer(e)
    if (!p) return
    const [x, y] = p
    onDrawStart?.()
    if (tool === 'text') {
      // поле появляется сразу (React успевает отрисовать его до всплытия события): дальше событие
      // не пускаем — сцена снимает фокус по pointerdown, а mousedown увёл бы его на холст
      e.evt.preventDefault()
      e.evt.stopPropagation()
      // клик мимо открытого поля — сначала сохраняем набранное
      if (textAt) commitText()
      setTextAt({ x, y })
      return
    }
    if (tool === 'zone') {
      if (draft?.kind === 'zone') {
        const [fx, fy] = draft.points
        const vertices = draft.points.length / 2 - 1
        if (vertices >= 3 && Math.hypot((x - fx) * width, (y - fy) * height) < CLOSE_RADIUS) return commitZone(draft)
        setDraft({ ...draft, points: [...draft.points.slice(0, -2), x, y, x, y] })
      } else {
        setDraft({ id: newId('s'), kind: 'zone', points: [x, y, x, y], color })
      }
      return
    }
    const id = newId('s')
    if (tool === 'circle' || tool === 'spotlight') setDraft({ id, kind: tool, x, y, rx: 0, ry: 0, color })
    else if (tool === 'freehand') setDraft({ id, kind: 'freehand', points: [x, y], color })
    else if (tool === 'pass') setDraft({ id, kind: 'arrow', points: [x, y, x, y], color, dashed: true })
    else setDraft({ id, kind: tool, points: [x, y, x, y], color })
  }

  const onMove = (e: Konva.KonvaEventObject<PointerEvent>): void => {
    if (!draft) return
    const p = pointer(e)
    if (!p) return
    const [x, y] = p
    if (draft.kind === 'circle' || draft.kind === 'spotlight') {
      // радиус в пикселях, чтобы круг оставался кругом при любом соотношении сторон
      const r = Math.hypot((x - draft.x) * width, (y - draft.y) * height)
      setDraft({ ...draft, rx: r / width, ry: r / height })
    } else if (draft.kind === 'freehand') {
      const n = draft.points.length
      if (Math.hypot(x - draft.points[n - 2], y - draft.points[n - 1]) > 0.002) {
        setDraft({ ...draft, points: [...draft.points, x, y] })
      }
    } else if (draft.kind === 'zone') {
      setDraft({ ...draft, points: [...draft.points.slice(0, -2), x, y] })
    } else if (draft.kind === 'arrow' || draft.kind === 'line') {
      setDraft({ ...draft, points: [draft.points[0], draft.points[1], x, y] })
    }
  }

  const onUp = (): void => {
    // зона рисуется кликами, а не протягиванием
    if (!draft || draft.kind === 'zone') return
    let big = false
    if (draft.kind === 'circle' || draft.kind === 'spotlight') big = draft.rx > MIN_SIZE
    else if (draft.kind === 'freehand') big = draft.points.length >= 6
    else if (draft.kind === 'arrow' || draft.kind === 'line') big = Math.hypot(draft.points[2] - draft.points[0], draft.points[3] - draft.points[1]) > MIN_SIZE
    if (big) onAdd(draft)
    setDraft(null)
  }

  const fontSize = textSizeFor(height)
  return (
    <>
      <Stage
        width={width}
        height={height}
        className={`drawing-layer${drawing ? ` is-drawing tool-${tool}` : ''}`}
        listening={drawing}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        onDblClick={() => {
          // Konva считает двойным кликом два любых клика подряд, даже в разных местах, —
          // замыкаем зону, только если две последние вершины совпали (настоящий двойной клик)
          if (draft?.kind !== 'zone') return
          const p = draft.points.slice(0, -2)
          const n = p.length
          if (n >= 8 && Math.hypot((p[n - 2] - p[n - 4]) * width, (p[n - 1] - p[n - 3]) * height) < 6) commitZone(draft)
        }}
      >
        <Layer ref={bgLayer} listening={false} />
        <Layer ref={dimLayer} listening={false} />
        <Layer ref={mainLayer} listening={false} />
        <Layer ref={draftLayer} listening={false} />
      </Stage>
      {draft?.kind === 'zone' && <div className="stage-hint stage-hint-top">Кликайте вершины зоны; замкнуть — клик по первой точке или двойной клик</div>}
      {textAt && (
        <input
          // новое место — новое поле: autoFocus срабатывает только при монтировании
          key={`${textAt.x}:${textAt.y}`}
          className="text-draft"
          autoFocus
          value={text}
          maxLength={MAX_TEXT_LENGTH}
          placeholder="Текст, Enter"
          aria-label="Текст подписи"
          style={{ left: textAt.x * width, top: textAt.y * height, color, fontSize }}
          onChange={(e) => setText(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitText()
            if (e.key === 'Escape') {
              // отмена подписи не должна закрывать окно схемы
              e.stopPropagation()
              textOpen.current = false
              setText('')
              setTextAt(null)
            }
          }}
        />
      )}
    </>
  )
}
