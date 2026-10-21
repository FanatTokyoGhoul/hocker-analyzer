import { describe, expect, it } from 'vitest'
import { NO_ZOOM, clampView, fitContain, panBy, zoomAt } from './geometry'

describe('fitContain', () => {
  it('вписывает с сохранением пропорций', () => {
    expect(fitContain({ width: 1000, height: 1000 }, 16 / 9)).toEqual({ width: 1000, height: 562 })
    expect(fitContain({ width: 0, height: 10 }, 1)).toEqual({ width: 0, height: 0 })
  })
})

describe('зум', () => {
  it('точка под курсором остаётся на месте', () => {
    const v = zoomAt(NO_ZOOM, 2, 0.25, 0.75)
    expect(v.z).toBe(2)
    // контентная точка 0.25/0.75 после зума видна там же
    expect(0.25 * v.z + v.tx).toBeCloseTo(0.25)
    expect(0.75 * v.z + v.ty).toBeCloseTo(0.75)
  })

  it('ограничивает увеличение и сдвиг, не показывая края за кадром', () => {
    expect(zoomAt(NO_ZOOM, 100, 0.5, 0.5).z).toBe(4)
    expect(zoomAt(NO_ZOOM, 0.5, 0.5, 0.5)).toEqual(NO_ZOOM)
    expect(panBy({ z: 2, tx: -0.5, ty: -0.5 }, 5, -5)).toEqual({ z: 2, tx: 0, ty: -1 })
    expect(clampView({ z: 1, tx: -0.3, ty: 0.2 })).toEqual(NO_ZOOM)
  })
})
