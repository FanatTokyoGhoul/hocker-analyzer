import { describe, expect, it } from 'vitest'
import type { LineShape, Shape } from '../../../shared/types'
import { boundsOf, dragHandle, handleAt, handlesOf, hitsShape, moveShape, sameShape, shapeAt } from './shapeEdit'

const S = { width: 1000, height: 500 }
const arrow: Shape = { id: 'a', kind: 'arrow', points: [0.1, 0.1, 0.5, 0.1], color: '#f00', dashed: true }
const circle: Shape = { id: 'c', kind: 'circle', x: 0.5, y: 0.5, rx: 0.05, ry: 0.1, color: '#0f0' }
const zone: Shape = { id: 'z', kind: 'zone', points: [0.6, 0.6, 0.9, 0.6, 0.75, 0.9], color: '#00f' }
const text: Shape = { id: 't', kind: 'text', x: 0.2, y: 0.7, text: 'Защитник', color: '#fff' }

describe('shapeEdit', () => {
  it('попадание в линию с допуском в пикселях', () => {
    expect(hitsShape(arrow, 0.3, 0.1 + 6 / S.height, S)).toBe(true)
    expect(hitsShape(arrow, 0.3, 0.1 + 20 / S.height, S)).toBe(false)
    expect(hitsShape(arrow, 0.6, 0.1, S)).toBe(false)
  })

  it('попадание в круг, зону и подпись', () => {
    expect(hitsShape(circle, 0.5, 0.5, S)).toBe(true)
    expect(hitsShape(circle, 0.5 + 0.05 + 5 / S.width, 0.5, S)).toBe(true)
    expect(hitsShape(circle, 0.7, 0.5, S)).toBe(false)
    expect(hitsShape(zone, 0.75, 0.7, S)).toBe(true)
    expect(hitsShape(zone, 0.95, 0.95, S)).toBe(false)
    expect(hitsShape(text, 0.21, 0.71, S)).toBe(true)
    expect(hitsShape(text, 0.19, 0.69, S)).toBe(false)
  })

  it('берёт верхнюю фигуру', () => {
    const top: Shape = { ...arrow, id: 'top' }
    expect(shapeAt([arrow, top], 0.3, 0.1, S)?.id).toBe('top')
    expect(shapeAt([arrow, top], 0.9, 0.2, S)).toBeNull()
  })

  it('ручки: концы линии, радиус круга, вершины зоны', () => {
    expect(handlesOf(arrow).map((h) => h.id)).toEqual(['p0', 'p1'])
    expect(handlesOf(circle)).toEqual([{ id: 'r', x: 0.55, y: 0.5 }])
    expect(handlesOf(zone).map((h) => h.id)).toEqual(['v0', 'v1', 'v2'])
    expect(handlesOf(text)).toEqual([])
    expect(handleAt(arrow, 0.5 + 4 / S.width, 0.1, S)).toBe('p1')
    expect(handleAt(arrow, 0.3, 0.1, S)).toBeNull()
  })

  it('тянет конец стрелки и сохраняет пунктир', () => {
    const moved = dragHandle(arrow, 'p1', 0.7, 0.3, S)
    expect(moved).toMatchObject({ points: [0.1, 0.1, 0.7, 0.3], dashed: true })
    expect(dragHandle(arrow, 'v0', 0.7, 0.3, S)).toBe(arrow)
  })

  it('радиус круга — в пикселях, круг остаётся кругом', () => {
    const c = dragHandle(circle, 'r', 0.6, 0.5, S) as Extract<Shape, { kind: 'circle' }>
    expect(c.rx * S.width).toBeCloseTo(100)
    expect(c.ry * S.height).toBeCloseTo(100)
  })

  it('двигает вершину зоны и фигуру целиком', () => {
    expect((dragHandle(zone, 'v1', 0.95, 0.65, S) as Extract<Shape, { kind: 'zone' }>).points).toEqual([0.6, 0.6, 0.95, 0.65, 0.75, 0.9])
    expect((moveShape(arrow, 0.1, 0.2) as LineShape).points).toEqual([0.2, 0.30000000000000004, 0.6, 0.30000000000000004])
    expect(moveShape(text, -0.1, 0.1)).toMatchObject({ x: 0.1, y: 0.7999999999999999 })
  })

  it('габариты и сравнение', () => {
    expect(boundsOf(zone, S)).toEqual({ x: 0.6, y: 0.6, w: 0.30000000000000004, h: 0.30000000000000004 })
    expect(boundsOf(circle, S)).toEqual({ x: 0.45, y: 0.4, w: 0.1, h: 0.2 })
    expect(sameShape(arrow, { ...arrow })).toBe(true)
    expect(sameShape(arrow, moveShape(arrow, 0.01, 0))).toBe(false)
  })
})
