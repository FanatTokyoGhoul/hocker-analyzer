import type { Shape } from '../../../shared/types'
import { textSizeFor } from './shapeRender'

/** Размер холста в пикселях: координаты фигур нормированы, а «попал/не попал» считаем в пикселях. */
export type Size = { width: number; height: number }

/** Ручка выделенной фигуры: конец линии (p0, p1), радиус круга (r), вершина зоны (v0, v1, …). */
export type Handle = { id: string; x: number; y: number }

/** Насколько близко (px) к линии или ручке считается попаданием. */
export const HIT_RADIUS = 8
export const HANDLE_RADIUS = 7
/** Меньше этого фигура вырождается (круг без радиуса, стрелка в точку). */
const MIN_SIZE = 0.004

const px = (x: number, y: number, s: Size): [number, number] => [x * s.width, y * s.height]

function distToSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

function distToPolyline(p: [number, number], points: number[], s: Size, closed: boolean): number {
  let best = Infinity
  const n = points.length / 2
  for (let i = 0; i < n - (closed ? 0 : 1); i++) {
    const j = (i + 1) % n
    best = Math.min(best, distToSegment(p, px(points[2 * i], points[2 * i + 1], s), px(points[2 * j], points[2 * j + 1], s)))
  }
  return best
}

function insidePolygon(x: number, y: number, points: number[]): boolean {
  let inside = false
  for (let i = 0, j = points.length - 2; i < points.length; j = i, i += 2) {
    const [xi, yi, xj, yj] = [points[i], points[i + 1], points[j], points[j + 1]]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Прямоугольник подписи (нормированный) — та же формула размера, что при отрисовке. */
export function textBox(shape: Extract<Shape, { kind: 'text' }>, s: Size): { x: number; y: number; w: number; h: number } {
  const size = textSizeFor(s.height)
  const pad = size * 0.3
  // жирный шрифт: средняя ширина символа ≈ 0.6 кегля
  const width = shape.text.length * size * 0.6 + pad * 2
  const height = size + pad * 2
  return { x: shape.x, y: shape.y, w: width / s.width, h: height / s.height }
}

/** Попадает ли точка (нормированная) в фигуру: по линии — с допуском, по площади — внутрь. */
export function hitsShape(shape: Shape, x: number, y: number, s: Size): boolean {
  const p = px(x, y, s)
  switch (shape.kind) {
    case 'arrow':
    case 'line': {
      const [x1, y1, x2, y2] = shape.points
      return distToSegment(p, px(x1, y1, s), px(x2, y2, s)) <= HIT_RADIUS
    }
    case 'circle':
    case 'spotlight': {
      const rx = Math.max(shape.rx * s.width, 1)
      const ry = Math.max(shape.ry * s.height, 1)
      const dx = p[0] - shape.x * s.width
      const dy = p[1] - shape.y * s.height
      // внутри круга или рядом с его контуром
      const k = Math.hypot(dx / rx, dy / ry)
      return k <= 1 || (k - 1) * Math.min(rx, ry) <= HIT_RADIUS
    }
    case 'freehand':
      return distToPolyline(p, shape.points, s, false) <= HIT_RADIUS
    case 'zone':
      return insidePolygon(x, y, shape.points) || distToPolyline(p, shape.points, s, true) <= HIT_RADIUS
    case 'text': {
      const b = textBox(shape, s)
      return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h
    }
  }
}

/** Верхняя (нарисованная последней) фигура под точкой. */
export function shapeAt(shapes: Shape[], x: number, y: number, s: Size): Shape | null {
  for (let i = shapes.length - 1; i >= 0; i--) if (hitsShape(shapes[i], x, y, s)) return shapes[i]
  return null
}

export function handlesOf(shape: Shape): Handle[] {
  switch (shape.kind) {
    case 'arrow':
    case 'line':
      return [
        { id: 'p0', x: shape.points[0], y: shape.points[1] },
        { id: 'p1', x: shape.points[2], y: shape.points[3] }
      ]
    case 'circle':
    case 'spotlight':
      return [{ id: 'r', x: shape.x + shape.rx, y: shape.y }]
    case 'zone':
      return Array.from({ length: shape.points.length / 2 }, (_, i) => ({ id: `v${i}`, x: shape.points[2 * i], y: shape.points[2 * i + 1] }))
    case 'freehand':
    case 'text':
      return []
  }
}

export function handleAt(shape: Shape, x: number, y: number, s: Size): string | null {
  const p = px(x, y, s)
  for (const h of handlesOf(shape)) {
    const [hx, hy] = px(h.x, h.y, s)
    if (Math.hypot(p[0] - hx, p[1] - hy) <= HANDLE_RADIUS + 3) return h.id
  }
  return null
}

const shiftPoints = (points: number[], dx: number, dy: number): number[] => points.map((v, i) => v + (i % 2 ? dy : dx))

/** Сдвиг фигуры целиком на (dx, dy) в нормированных координатах. */
export function moveShape(shape: Shape, dx: number, dy: number): Shape {
  switch (shape.kind) {
    case 'arrow':
    case 'line':
      return { ...shape, points: shiftPoints(shape.points, dx, dy) as [number, number, number, number] }
    case 'freehand':
    case 'zone':
      return { ...shape, points: shiftPoints(shape.points, dx, dy) }
    case 'circle':
    case 'spotlight':
    case 'text':
      return { ...shape, x: shape.x + dx, y: shape.y + dy }
  }
}

/** Перетаскивание ручки в точку (x, y). Неизвестная ручка — фигура без изменений. */
export function dragHandle(shape: Shape, handle: string, x: number, y: number, s: Size): Shape {
  switch (shape.kind) {
    case 'arrow':
    case 'line': {
      const points = [...shape.points] as [number, number, number, number]
      if (handle === 'p0') [points[0], points[1]] = [x, y]
      else if (handle === 'p1') [points[2], points[3]] = [x, y]
      else return shape
      return { ...shape, points }
    }
    case 'circle':
    case 'spotlight': {
      if (handle !== 'r') return shape
      // радиус в пикселях, чтобы круг оставался кругом при любом соотношении сторон
      const r = Math.max(Math.hypot((x - shape.x) * s.width, (y - shape.y) * s.height), MIN_SIZE * s.width)
      return { ...shape, rx: r / s.width, ry: r / s.height }
    }
    case 'zone': {
      const i = /^v(\d+)$/.exec(handle)
      const k = i ? Number(i[1]) : -1
      if (k < 0 || 2 * k >= shape.points.length) return shape
      const points = [...shape.points]
      points[2 * k] = x
      points[2 * k + 1] = y
      return { ...shape, points }
    }
    case 'freehand':
    case 'text':
      return shape
  }
}

/** Одинаковые ли фигуры (после перетаскивания «на месте» историю не засоряем). */
export const sameShape = (a: Shape, b: Shape): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Габариты фигуры (нормированные) — для рамки выделения. */
export function boundsOf(shape: Shape, s: Size): { x: number; y: number; w: number; h: number } {
  switch (shape.kind) {
    case 'circle':
    case 'spotlight':
      return { x: shape.x - shape.rx, y: shape.y - shape.ry, w: shape.rx * 2, h: shape.ry * 2 }
    case 'text':
      return textBox(shape, s)
    default: {
      const xs = shape.points.filter((_, i) => i % 2 === 0)
      const ys = shape.points.filter((_, i) => i % 2 === 1)
      const x = Math.min(...xs)
      const y = Math.min(...ys)
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
    }
  }
}
