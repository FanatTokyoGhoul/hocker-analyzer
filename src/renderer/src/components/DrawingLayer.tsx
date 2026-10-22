import { useEffect, useMemo, useRef, useState } from 'react'
import { Layer, Stage } from 'react-konva'
import Konva from 'konva'
import type { Shape, ZoneShape } from '../../../shared/types'
import { MAX_TEXT_LENGTH } from '../../../shared/project'
import { newId } from '../lib/ids'
import { buildRink } from '../lib/rink'
import { createShapeNode, fillDim, fillMain, textSizeFor } from '../lib/shapeRender'
import { isTyping } from '../hooks/useHotkeys'
import { HANDLE_RADIUS, boundsOf, dragHandle, handleAt, handlesOf, moveShape, sameShape, shapeAt } from '../lib/shapeEdit'

/** select — правка готовых фигур: выделить, перетащить, потянуть за ручки. */
export type Tool = 'none' | 'select' | 'arrow' | 'pass' | 'line' | 'circle' | 'spotlight' | 'zone' | 'text' | 'freehand'

type Props = {
  width: number
  height: number
  shapes: Shape[]
  editable: boolean
  tool: Tool
  color: string
  onAdd(shape: Shape): void
  /** Правка и удаление готовых фигур; без них фигуры только добавляются. */
  onUpdate?(shape: Shape): void
  onDelete?(id: string): void
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

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
/** Сдвиг, при котором хотя бы краешек фигуры (5% кадра) остаётся в кадре. */
function clampMove(b: { x: number; y: number; w: number; h: number }, dx: number, dy: number): [number, number] {
  const keep = 0.05
  return [Math.min(1 - keep - b.x, Math.max(keep - b.x - b.w, dx)), Math.min(1 - keep - b.y, Math.max(keep - b.y - b.h, dy))]
}

/** Идёт перетаскивание: исходная фигура, текущая и ручка (null — двигаем целиком). */
type Edit = { orig: Shape; shape: Shape; handle: string | null; from: [number, number] }

/**
 * Canvas-слой поверх видео (или схемы): показывает фигуры и даёт рисовать новые.
 * Только что нарисованная фигура остаётся выделенной: её концы можно сразу поправить, Delete — удалить;
 * с Shift новая фигура начинается даже на ручке. Инструмент «Правка» выделяет любую фигуру, двигает её,
 * а выбор цвета в нём перекрашивает выделенную. Выделение снимают Esc или клик мимо.
 */
export function DrawingLayer({ width, height, shapes, editable, tool, color, onAdd, onUpdate, onDelete, onDrawStart, background }: Props): React.JSX.Element {
  const [draft, setDraft] = useState<Shape | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [edit, setEdit] = useState<Edit | null>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const editLayer = useRef<Konva.Layer>(null)
  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null)
  const [text, setText] = useState('')
  const bgLayer = useRef<Konva.Layer>(null)
  const dimLayer = useRef<Konva.Layer>(null)
  const mainLayer = useRef<Konva.Layer>(null)
  const draftLayer = useRef<Konva.Layer>(null)
  const drawing = editable && tool !== 'none'
  const canEdit = drawing && !!onUpdate
  const size = { width, height }
  // во время перетаскивания показываем фигуру в новом положении, в проект она попадает по отпусканию
  const shown = useMemo(() => (edit ? shapes.map((s) => (s.id === edit.shape.id ? edit.shape : s)) : shapes), [shapes, edit])
  // фигура могла исчезнуть (отмена, другой кадр) — тогда и выделения нет
  const selected = canEdit && selectedId ? (shown.find((s) => s.id === selectedId) ?? null) : null
  /** Сохранить набранную подпись (определена ниже; через ref — для эффектов). */
  const commitTextRef = useRef<() => void>(() => undefined)

  // рисование выключили посреди штриха (Space, конец паузы на рисунке, смена инструмента) — бросаем незаконченную
  // фигуру; набранную подпись сохраняем: кнопки инструментов не забирают фокус, и blur у поля не случится
  useEffect(() => {
    commitTextRef.current()
    setDraft(null)
    setTextAt(null)
    setEdit(null)
  }, [drawing, tool])
  // рисовать перестали (пуск, другой кадр без момента, закрыли меню) — выделение снимаем
  useEffect(() => {
    if (!drawing) setSelectedId(null)
    // курсор «тянуть/двигать» ставится вручную — возвращаем обычный
    const container = stageRef.current?.container()
    if (container) container.style.cursor = ''
  }, [drawing, tool])
  // фигуры больше нет на кадре (другой кадр, отмена) — забываем выделение, чтобы оно не вернулось само
  useEffect(() => {
    if (selectedId && !edit && !shapes.some((s) => s.id === selectedId)) setSelectedId(null)
  }, [selectedId, edit, shapes])
  // окно схемы закрыли с открытым полем подписи
  useEffect(() => () => commitTextRef.current(), [])

  // готовые фигуры перерисовываем только при их изменении, незаконченную — в отдельном слое на каждом движении
  useEffect(() => {
    if (mainLayer.current) fillMain(mainLayer.current, shown, width, height)
  }, [shown, width, height])
  const spotDraft = draft?.kind === 'spotlight' ? draft : null
  const dimShapes = useMemo(() => (spotDraft ? [...shown, spotDraft] : shown), [shown, spotDraft])
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

  // рамка и ручки выделенной фигуры
  useEffect(() => {
    const layer = editLayer.current
    if (!layer) return
    layer.destroyChildren()
    if (selected) {
      const b = boundsOf(selected, { width, height })
      const pad = 6
      layer.add(
        new Konva.Rect({
          x: b.x * width - pad,
          y: b.y * height - pad,
          width: b.w * width + pad * 2,
          height: b.h * height + pad * 2,
          stroke: '#ffffff',
          strokeWidth: 1,
          dash: [4, 4],
          opacity: 0.8
        })
      )
      for (const hd of handlesOf(selected)) {
        layer.add(new Konva.Circle({ x: hd.x * width, y: hd.y * height, radius: HANDLE_RADIUS, fill: '#ffffff', stroke: selected.color, strokeWidth: 2 }))
      }
    }
    layer.batchDraw()
  }, [selected, width, height])

  /** Поверх открыто модальное окно (например, схема), а этот слой под ним: клавиши и цвет — не для него. */
  const covered = (): boolean => {
    const modals = document.querySelectorAll('[aria-modal="true"]')
    const host = stageRef.current?.container()
    const top = modals[modals.length - 1]
    return !!top && !!host && !top.contains(host)
  }

  // Delete — удалить выделенную, Esc — снять выделение (раньше, чем Esc выключит инструмент или закроет окно)
  const selectedKey = selected?.id ?? null
  useEffect(() => {
    if (!selectedKey) return
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e.target) || covered()) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        e.stopPropagation()
        onDelete?.(selectedKey)
        setSelectedId(null)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [selectedKey, onDelete])

  // в «Правке» выбранный цвет перекрашивает выделенную фигуру; с инструментом рисования цвет —
  // для следующей фигуры, а не для только что нарисованной
  const lastColor = useRef(color)
  useEffect(() => {
    if (lastColor.current === color) return
    lastColor.current = color
    if (tool === 'select' && selected && !edit && selected.color !== color && !covered()) onUpdate?.({ ...selected, color })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- реагируем только на смену цвета
  }, [color])

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

  /** Добавить новую фигуру и оставить её выделенной — чтобы сразу поправить. */
  const add = (shape: Shape): void => {
    onAdd(shape)
    if (onUpdate) setSelectedId(shape.id)
  }

  const commitZone = (z: ZoneShape): void => {
    const points = zoneVertices(z.points.slice(0, -2), width, height)
    if (points.length >= 6) add({ ...z, points })
    setDraft(null)
  }

  // Enter и последующий blur при размонтировании поля не должны добавить подпись дважды
  const textOpen = useRef(false)
  textOpen.current = textAt !== null
  const commitText = (): void => {
    if (!textOpen.current) return
    textOpen.current = false
    const value = text.trim()
    if (textAt && value) add({ id: newId('s'), kind: 'text', x: textAt.x, y: textAt.y, text: value, color })
    setTextAt(null)
    setText('')
  }
  commitTextRef.current = commitText

  const onDown = (e: Konva.KonvaEventObject<PointerEvent>): void => {
    if (!drawing || e.evt.button !== 0) return
    const p = pointer(e)
    if (!p) return
    const [x, y] = p
    if (canEdit && !textAt && draft?.kind !== 'zone') {
      // ручки выделенной фигуры важнее нового рисунка: конец стрелки можно сразу подвинуть.
      // С Shift — всегда новая фигура: следующую стрелку можно начать прямо от конца предыдущей
      const handle = selected && !(e.evt.shiftKey && tool !== 'select') ? handleAt(selected, x, y, size) : null
      if (selected && handle) {
        onDrawStart?.()
        setEdit({ orig: selected, shape: selected, handle, from: [x, y] })
        return
      }
      if (tool === 'select') {
        const hit = shapeAt(shown, x, y, size)
        setSelectedId(hit?.id ?? null)
        if (hit) {
          onDrawStart?.()
          setEdit({ orig: hit, shape: hit, handle: null, from: [x, y] })
        }
        return
      }
      setSelectedId(null)
    }
    if (tool === 'select') return
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
    const p = pointer(e)
    if (!p) return
    const [x, y] = p
    if (edit) {
      // фигура не уезжает за край кадра: иначе её уже не выделить
      const shape = edit.handle
        ? dragHandle(edit.orig, edit.handle, clamp01(x), clamp01(y), size)
        : moveShape(edit.orig, ...clampMove(boundsOf(edit.orig, size), x - edit.from[0], y - edit.from[1]))
      setEdit({ ...edit, shape })
      return
    }
    if (!draft) {
      // подсказка курсором: ручку можно тянуть, фигуру в режиме правки — двигать
      const container = e.target.getStage()?.container()
      if (container && canEdit) {
        const overHandle = selected && handleAt(selected, x, y, size)
        const overShape = tool === 'select' && shapeAt(shown, x, y, size)
        container.style.cursor = overHandle ? 'grab' : overShape ? 'move' : ''
      }
      return
    }
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
    if (edit) {
      if (!sameShape(edit.orig, edit.shape)) onUpdate?.(edit.shape)
      setEdit(null)
      return
    }
    // зона рисуется кликами, а не протягиванием
    if (!draft || draft.kind === 'zone') return
    let big = false
    if (draft.kind === 'circle' || draft.kind === 'spotlight') big = draft.rx > MIN_SIZE
    else if (draft.kind === 'freehand') big = draft.points.length >= 6
    else if (draft.kind === 'arrow' || draft.kind === 'line') big = Math.hypot(draft.points[2] - draft.points[0], draft.points[3] - draft.points[1]) > MIN_SIZE
    if (big) add(draft)
    setDraft(null)
  }

  const fontSize = textSizeFor(height)
  return (
    <>
      <Stage
        ref={stageRef}
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
        <Layer ref={editLayer} listening={false} />
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
