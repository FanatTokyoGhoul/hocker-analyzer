import Konva from 'konva'
import type { Shape, SpotlightShape } from '../../../shared/types'
import { RINK_ASPECT, buildRink } from './rink'
import { fitContain } from './geometry'

/** Толщина линий и размер текста зависят от высоты кадра — на экране и в экспорте 4K выглядят одинаково. */
export const strokeFor = (h: number): number => Math.max(2, h / 180)
export const textSizeFor = (h: number): number => Math.max(12, h / 24)
const SPOTLIGHT_DIM = 'rgba(0, 0, 0, 0.6)'

/** '#rrggbb' + прозрачность → rgba() для заливки зон. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return hex
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`
}

type Options = {
  /** Незамкнутая зона в процессе рисования. */
  draft?: boolean
}

/** Konva-узел фигуры (кроме затемнения подсветки — оно рисуется отдельным слоем, см. buildSpotlightDim). */
export function createShapeNode(s: Shape, w: number, h: number, opts: Options = {}): Konva.Shape | Konva.Group {
  const stroke = strokeFor(h)
  const common = { stroke: s.color, strokeWidth: stroke, lineCap: 'round' as const, lineJoin: 'round' as const, listening: false }
  switch (s.kind) {
    case 'arrow':
    case 'line': {
      const [x1, y1, x2, y2] = s.points
      const points = [x1 * w, y1 * h, x2 * w, y2 * h]
      const dash = s.dashed ? [stroke * 3, stroke * 2.5] : undefined
      return s.kind === 'arrow'
        ? new Konva.Arrow({ ...common, points, dash, fill: s.color, pointerLength: stroke * 4, pointerWidth: stroke * 4 })
        : new Konva.Line({ ...common, points, dash })
    }
    case 'circle':
      return new Konva.Ellipse({ ...common, x: s.x * w, y: s.y * h, radiusX: s.rx * w, radiusY: s.ry * h })
    case 'spotlight':
      // контур подсветки — тонкий, само «пятно» делает затемнение вокруг
      return new Konva.Ellipse({ ...common, strokeWidth: stroke * 0.6, x: s.x * w, y: s.y * h, radiusX: s.rx * w, radiusY: s.ry * h })
    case 'freehand':
      return new Konva.Line({ ...common, points: s.points.map((v, i) => v * (i % 2 ? h : w)), tension: 0.4 })
    case 'zone': {
      const points = s.points.map((v, i) => v * (i % 2 ? h : w))
      return opts.draft
        ? new Konva.Line({ ...common, points, dash: [stroke * 2, stroke * 2] })
        : new Konva.Line({ ...common, points, closed: true, fill: withAlpha(s.color, 0.28) })
    }
    case 'text': {
      const size = textSizeFor(h)
      const label = new Konva.Label({ x: s.x * w, y: s.y * h, listening: false })
      label.add(new Konva.Tag({ fill: 'rgba(0, 0, 0, 0.6)', cornerRadius: size * 0.25 }))
      label.add(new Konva.Text({ text: s.text, fontSize: size, fontStyle: 'bold', fontFamily: 'Inter, system-ui, sans-serif', fill: s.color, padding: size * 0.3 }))
      return label
    }
  }
}

/** Затемнение вокруг подсветок: полупрозрачный прямоугольник с «дырками». Должно лежать в своём слое. */
export function buildSpotlightDim(spots: SpotlightShape[], w: number, h: number): Konva.Group | null {
  if (!spots.length) return null
  const group = new Konva.Group({ listening: false })
  group.add(new Konva.Rect({ x: 0, y: 0, width: w, height: h, fill: SPOTLIGHT_DIM }))
  for (const s of spots) {
    group.add(
      new Konva.Ellipse({ x: s.x * w, y: s.y * h, radiusX: s.rx * w, radiusY: s.ry * h, fill: '#000', globalCompositeOperation: 'destination-out' })
    )
  }
  return group
}

const spotsOf = (shapes: Shape[]): SpotlightShape[] => shapes.filter((s): s is SpotlightShape => s.kind === 'spotlight')

/** Перерисовывает слой затемнения подсветок. */
export function fillDim(dim: Konva.Layer, shapes: Shape[], w: number, h: number): void {
  dim.destroyChildren()
  const spot = buildSpotlightDim(spotsOf(shapes), w, h)
  if (spot) dim.add(spot)
  dim.batchDraw()
}

/** Перерисовывает слой фигур. draftId — незаконченная зона (рисуется незамкнутой). */
export function fillMain(main: Konva.Layer, shapes: Shape[], w: number, h: number, draftId?: string): void {
  main.destroyChildren()
  for (const s of shapes) main.add(createShapeNode(s, w, h, { draft: s.id === draftId }))
  main.batchDraw()
}

export function fillLayers(dim: Konva.Layer, main: Konva.Layer, shapes: Shape[], w: number, h: number): void {
  fillDim(dim, shapes, w, h)
  fillMain(main, shapes, w, h)
}

/**
 * Картинка с фигурами (PNG data URL) в заданном размере — для экспорта в видео.
 * background: 'rink' — на схеме площадки (непрозрачная), иначе прозрачный фон поверх кадра.
 */
export function renderShapesPng(shapes: Shape[], w: number, h: number, background?: 'rink'): string {
  const container = document.createElement('div')
  const stage = new Konva.Stage({ container, width: w, height: h })
  try {
    if (background === 'rink') {
      const bg = new Konva.Layer({ listening: false })
      bg.add(buildRink(w, h))
      stage.add(bg)
    }
    const dim = new Konva.Layer({ listening: false })
    const main = new Konva.Layer({ listening: false })
    stage.add(dim, main)
    fillLayers(dim, main, shapes, w, h)
    return stage.toDataURL({ mimeType: 'image/png', pixelRatio: 1 })
  } finally {
    stage.destroy()
  }
}

/** Схема площадки с фигурами в кадре w×h (площадка по центру, поля тёмные) — для экспорта перед клипом. */
export function renderBoardPng(shapes: Shape[], w: number, h: number): string {
  const container = document.createElement('div')
  const stage = new Konva.Stage({ container, width: w, height: h })
  try {
    const rink = fitContain({ width: Math.round(w * 0.92), height: Math.round(h * 0.92) }, RINK_ASPECT)
    const pos = { x: Math.round((w - rink.width) / 2), y: Math.round((h - rink.height) / 2) }
    const bg = new Konva.Layer({ listening: false })
    bg.add(new Konva.Rect({ x: 0, y: 0, width: w, height: h, fill: '#14171c' }))
    const g = buildRink(rink.width, rink.height)
    g.position(pos)
    bg.add(g)
    const dim = new Konva.Layer({ listening: false, ...pos, clipX: 0, clipY: 0, clipWidth: rink.width, clipHeight: rink.height })
    const main = new Konva.Layer({ listening: false, ...pos })
    stage.add(bg, dim, main)
    fillLayers(dim, main, shapes, rink.width, rink.height)
    return stage.toDataURL({ mimeType: 'image/png', pixelRatio: 1 })
  } finally {
    stage.destroy()
  }
}

/** Подпись клипа (название, теги, заметка) в левом нижнем углу прозрачного кадра w×h. */
export function renderCaptionPng(title: string, subtitle: string, w: number, h: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const big = Math.round(h / 20)
  const small = Math.round(h / 34)
  const pad = Math.round(h / 40)
  const maxWidth = w * 0.7
  const font = 'Inter, system-ui, sans-serif'
  ctx.font = `700 ${big}px ${font}`
  const fit = (text: string): string => {
    if (ctx.measureText(text).width <= maxWidth) return text
    let t = text
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1)
    return `${t}…`
  }
  const line1 = fit(title)
  const w1 = ctx.measureText(line1).width
  ctx.font = `500 ${small}px ${font}`
  const line2 = subtitle ? fit(subtitle) : ''
  const w2 = line2 ? ctx.measureText(line2).width : 0
  const boxW = Math.max(w1, w2) + pad * 2
  const boxH = big + (line2 ? small + pad * 0.6 : 0) + pad * 1.6
  const x = pad * 1.5
  const y = h - boxH - pad * 1.5
  ctx.fillStyle = 'rgba(10, 12, 16, 0.72)'
  ctx.beginPath()
  ctx.roundRect(x, y, boxW, boxH, pad * 0.6)
  ctx.fill()
  ctx.fillStyle = '#3b82f6'
  ctx.fillRect(x, y, Math.max(3, pad * 0.25), boxH)
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 ${big}px ${font}`
  ctx.fillText(line1, x + pad, y + pad * 0.8)
  if (line2) {
    ctx.fillStyle = '#c9d1dc'
    ctx.font = `500 ${small}px ${font}`
    ctx.fillText(line2, x + pad, y + pad * 0.8 + big + pad * 0.6)
  }
  return canvas.toDataURL('image/png')
}
