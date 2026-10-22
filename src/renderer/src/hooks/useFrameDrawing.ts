import { useCallback, useMemo, type Dispatch } from 'react'
import type { Moment, Project, Shape } from '../../../shared/types'
import { drawingVideoId, findDrawingIndex, momentAt, type ProjectAction } from '../lib/projectState'
import { frameIndex } from '../lib/time'

type Options = {
  project: Project | null
  moments: Moment[]
  dispatch: Dispatch<ProjectAction>
  /** Локальное время и пауза активного видео. */
  time: number
  paused: boolean
  fps: number
  offset: number
  videoId: string
  /** Видео открыто и не конвертируется. */
  ready: boolean
  /** Цвет фигуры использован — для «недавних». */
  onColorUsed(color: string): void
}

/**
 * Рисунки на текущем кадре активного видео: что показать, можно ли рисовать, добавить/убрать фигуру.
 * Рисунок хранится в моменте на середине кадра (время проекта); «тот же кадр» — в пределах полукадра.
 */
export function useFrameDrawing({ project, moments, dispatch, time, paused, fps, offset, videoId, ready, onColorUsed }: Options) {
  const halfFrame = 0.5 / fps
  const frame = frameIndex(time, fps)
  /** Середина текущего кадра во времени проекта. */
  const frameTime = (frame + 0.5) / fps + offset
  const activeMoment = momentAt(moments, time + offset, halfFrame)
  const canDraw = ready && paused && !!activeMoment

  let hint: string | null = null
  if (ready) {
    if (!paused) hint = 'Поставьте видео на паузу, чтобы рисовать'
    else if (!activeMoment) hint = 'Рисунок привязывается к моменту — перейдите внутрь момента или создайте его (I / O)'
  }

  const shapes = useMemo(
    () =>
      project
        ? moments.flatMap((m) =>
            (m.drawings ?? []).filter((d) => drawingVideoId(project, d) === videoId && Math.abs(d.time - frameTime) <= halfFrame).flatMap((d) => d.shapes)
          )
        : [],
    [project, moments, videoId, frameTime, halfFrame]
  )
  const shapeCount =
    project && activeMoment ? (activeMoment.drawings?.[findDrawingIndex(project, activeMoment, frameTime, halfFrame, videoId)]?.shapes.length ?? 0) : 0

  const momentId = activeMoment?.id ?? null
  const addShape = useCallback(
    (shape: Shape) => {
      // за время рисования видео могли запустить — тогда фигура не к этому кадру
      if (!momentId || !canDraw) return
      dispatch({ type: 'addShape', momentId, time: frameTime, videoId, tolerance: halfFrame, shape })
      onColorUsed(shape.color)
    },
    [momentId, canDraw, frameTime, videoId, halfFrame, dispatch, onColorUsed]
  )
  const undoShape = useCallback(() => {
    if (momentId) dispatch({ type: 'undoShape', momentId, time: frameTime, videoId, tolerance: halfFrame })
  }, [momentId, frameTime, videoId, halfFrame, dispatch])
  const clearShapes = useCallback(() => {
    if (momentId) dispatch({ type: 'clearShapes', momentId, time: frameTime, videoId, tolerance: halfFrame })
  }, [momentId, frameTime, videoId, halfFrame, dispatch])

  // правка и удаление — только видимых на этом кадре фигур и только когда рисовать можно
  const updateShape = useCallback(
    (shape: Shape) => {
      const before = shapes.find((s) => s.id === shape.id)
      if (!canDraw || !before) return
      dispatch({ type: 'updateShape', shape })
      // перекрасили — цвет в «недавние», как у новой фигуры
      if (before.color !== shape.color) onColorUsed(shape.color)
    },
    [canDraw, shapes, dispatch, onColorUsed]
  )
  const deleteShape = useCallback(
    (id: string) => {
      if (canDraw && shapes.some((s) => s.id === id)) dispatch({ type: 'deleteShape', shapeId: id })
    },
    [canDraw, shapes, dispatch]
  )

  return { frame, activeMoment, canDraw, hint, shapes, shapeCount, addShape, updateShape, deleteShape, undoShape, clearShapes }
}
