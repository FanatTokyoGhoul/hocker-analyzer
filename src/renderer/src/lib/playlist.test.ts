import { describe, expect, it } from 'vitest'
import type { Moment } from '../../../shared/types'
import { decidePlaylistStep } from './playlist'

const items: Moment[] = [
  { id: 'a', title: 'a', start: 78, end: 85 },
  { id: 'b', title: 'b', start: 120, end: 125 }
]
const fps = 25

describe('decidePlaylistStep', () => {
  it('продолжает внутри отрезка', () => {
    expect(decidePlaylistStep(items, 0, 82, fps)).toEqual({ kind: 'continue' })
  })

  it('переходит к следующему моменту на последнем кадре', () => {
    expect(decidePlaylistStep(items, 0, 84.99, fps)).toEqual({ kind: 'next', index: 1, seek: 120 })
  })

  it('заканчивает после последнего момента', () => {
    expect(decidePlaylistStep(items, 1, 125, fps)).toEqual({ kind: 'finish' })
    expect(decidePlaylistStep([], 0, 0, fps)).toEqual({ kind: 'finish' })
  })
})
