import { describe, expect, it } from 'vitest'
import { parseRemoteCommand } from './remote'

describe('команды пульта', () => {
  it('пропускает известные команды', () => {
    expect(parseRemoteCommand({ type: 'togglePlay', extra: 1 })).toEqual({ type: 'togglePlay' })
    expect(parseRemoteCommand({ type: 'stepFrame', delta: -1 })).toEqual({ type: 'stepFrame', delta: -1 })
    expect(parseRemoteCommand({ type: 'setRate', rate: 0.5 })).toEqual({ type: 'setRate', rate: 0.5 })
    expect(parseRemoteCommand({ type: 'playMoment', id: 'm1' })).toEqual({ type: 'playMoment', id: 'm1' })
    expect(parseRemoteCommand({ type: 'addMoment', title: 'Гол', tags: ['гол'] })).toEqual({ type: 'addMoment', title: 'Гол', tags: ['гол'] })
    expect(parseRemoteCommand({ type: 'quickTag', index: 8 })).toEqual({ type: 'quickTag', index: 8 })
    const shape = { id: 's', kind: 'arrow', points: [0.1, 0.2, 0.3, 0.4], color: '#ff0000', dashed: true }
    expect(parseRemoteCommand({ type: 'addShape', shape, frameKey: 'k' })).toEqual({ type: 'addShape', shape, frameKey: 'k' })
    expect(parseRemoteCommand({ type: 'addShape', shape: { ...shape, color: '#F00' }, frameKey: 'v1:90' })).toEqual({
      type: 'addShape',
      shape: { ...shape, color: '#ff0000' },
      frameKey: 'v1:90'
    })
    expect(parseRemoteCommand({ type: 'undoShape', frameKey: 'v1:90' })).toEqual({ type: 'undoShape', frameKey: 'v1:90' })
    expect(parseRemoteCommand({ type: 'clearShapes', frameKey: 'k' })).toEqual({ type: 'clearShapes', frameKey: 'k' })
    expect(parseRemoteCommand({ type: 'drawStart', x: 1 })).toEqual({ type: 'drawStart' })
    expect(parseRemoteCommand({ type: 'stepMs', sign: -1 })).toEqual({ type: 'stepMs', sign: -1 })
    expect(parseRemoteCommand({ type: 'selectVideo', id: 'v2' })).toEqual({ type: 'selectVideo', id: 'v2' })
    expect(parseRemoteCommand({ type: 'quickTag', index: 0 })).toEqual({ type: 'quickTag', index: 0 })
  })

  it('отклоняет неизвестное и некорректное', () => {
    for (const raw of [
      null,
      'togglePlay',
      { type: 'eval', code: '1' },
      { type: 'stepFrame', delta: 5 },
      { type: 'setRate', rate: 'fast' },
      { type: 'setRate', rate: Infinity },
      { type: 'playMoment', id: '' },
      { type: 'playMoment', id: 'x'.repeat(101) },
      { type: 'addMoment', title: 'x', tags: 'гол' },
      { type: 'addMoment', title: 'x'.repeat(201), tags: [] },
      { type: 'quickTag', index: 9 },
      { type: 'quickTag', index: 1.5 },
      { type: 'addShape', shape: { kind: 'blob' } },
      { type: 'addShape', shape: { id: 's', kind: 'line', points: [0, 0, 50, 50], color: '#fff' } },
      { type: 'addShape', shape: { id: '', kind: 'line', points: [0, 0, 1, 1], color: '#fff' } },
      { type: 'addShape', shape: { id: 's', kind: 'line', points: [0, 0, 1, 1], color: 'red;background:url(x)' } },
      { type: 'addShape', shape: { id: 's', kind: 'circle', x: 0.5, y: 0.5, rx: 1e9, ry: 0.1, color: '#fff' } },
      { type: 'addShape', shape: { id: 's', kind: 'freehand', points: Array(4002).fill(0.5), color: '#fff' } },
      { type: 'addShape', shape: { id: 's', kind: 'line', points: [0, 0, 1, 1], color: '#fff' }, frameKey: 5 },
      { type: 'undoShape', frameKey: 'x'.repeat(141) },
      // без ключа кадра рисовать нельзя — неизвестно, по какому кадру
      { type: 'addShape', shape: { id: 's', kind: 'line', points: [0, 0, 1, 1], color: '#fff' } },
      { type: 'clearShapes' },
      { type: 'stepMs', sign: 0 },
      { type: 'quickTag', index: -1 },
      { type: 'addMoment', title: 'x', tags: Array(21).fill('t') },
      { type: 'addMoment', title: 'x', tags: ['x'.repeat(41)] }
    ]) {
      expect(parseRemoteCommand(raw)).toBeNull()
    }
  })
})
