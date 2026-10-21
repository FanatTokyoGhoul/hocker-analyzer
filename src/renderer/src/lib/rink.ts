import Konva from 'konva'

/** Площадка НХЛ 200×85 футов: координаты схемы нормированы к этому прямоугольнику. */
export const RINK_LENGTH = 200
export const RINK_WIDTH = 85
export const RINK_ASPECT = RINK_LENGTH / RINK_WIDTH

const ICE = '#f4f8fb'
const RED = '#d62828'
const BLUE = '#1d4e89'
const BOARDS = '#1b2430'
const OUTSIDE = '#14171c'

/** Разметка площадки как Konva-группа размером w×h (без интерактивности). */
export function buildRink(w: number, h: number): Konva.Group {
  const sx = w / RINK_LENGTH
  const sy = h / RINK_WIDTH
  const s = Math.min(sx, sy)
  const g = new Konva.Group({ listening: false })
  const x = (ft: number): number => ft * sx
  const y = (ft: number): number => ft * sy

  g.add(new Konva.Rect({ x: 0, y: 0, width: w, height: h, fill: OUTSIDE }))
  g.add(new Konva.Rect({ x: 0, y: 0, width: w, height: h, cornerRadius: 28 * s, fill: ICE, stroke: BOARDS, strokeWidth: Math.max(2, 1.2 * s) }))

  const vline = (ft: number, color: string, width: number): void => {
    // у бортов линии короче из-за скруглений — для схемы достаточно отступа
    const inset = ft < 28 || ft > RINK_LENGTH - 28 ? 6 : 0
    g.add(new Konva.Line({ points: [x(ft), y(inset), x(ft), y(RINK_WIDTH - inset)], stroke: color, strokeWidth: width * s }))
  }
  vline(11, RED, 0.35)
  vline(RINK_LENGTH - 11, RED, 0.35)
  vline(75, BLUE, 1)
  vline(125, BLUE, 1)
  vline(100, RED, 1)

  const circle = (cx: number, cy: number, r: number, color: string): void => {
    g.add(new Konva.Ellipse({ x: x(cx), y: y(cy), radiusX: r * sx, radiusY: r * sy, stroke: color, strokeWidth: 0.35 * s }))
  }
  const dot = (cx: number, cy: number, r: number, color: string): void => {
    g.add(new Konva.Ellipse({ x: x(cx), y: y(cy), radiusX: r * sx, radiusY: r * sy, fill: color }))
  }
  circle(100, 42.5, 15, BLUE)
  dot(100, 42.5, 0.6, BLUE)
  for (const cx of [31, RINK_LENGTH - 31]) {
    for (const cy of [20.5, 64.5]) {
      circle(cx, cy, 15, RED)
      dot(cx, cy, 1, RED)
    }
  }
  for (const cx of [80, 120]) for (const cy of [20.5, 64.5]) dot(cx, cy, 1, RED)

  // площадь вратаря и ворота
  for (const [gx, dir] of [[11, 1], [RINK_LENGTH - 11, -1]] as const) {
    g.add(
      new Konva.Wedge({
        x: x(gx),
        y: y(42.5),
        radius: 6 * s,
        angle: 180,
        rotation: dir === 1 ? -90 : 90,
        fill: '#a8d4f5',
        stroke: RED,
        strokeWidth: 0.3 * s
      })
    )
    g.add(
      new Konva.Rect({
        x: dir === 1 ? x(gx - 3.3) : x(gx),
        y: y(39.5),
        width: 3.3 * sx,
        height: 6 * sy,
        stroke: RED,
        strokeWidth: 0.35 * s
      })
    )
  }
  return g
}
