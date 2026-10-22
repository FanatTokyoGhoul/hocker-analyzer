import { describe, expect, it, vi } from 'vitest'
import type { RemoteCommand } from '../../../shared/remote'
import { runRemoteCommand, type RemoteActions } from './remoteCommands'

const shape = { id: 's', kind: 'line' as const, points: [0, 0, 1, 1] as [number, number, number, number], color: '#fff' }

// команда → какое действие и с какими аргументами
const cases: [RemoteCommand, keyof RemoteActions, unknown[]][] = [
  [{ type: 'togglePlay' }, 'togglePlay', []],
  [{ type: 'continue' }, 'release', []],
  [{ type: 'stepFrame', delta: -1 }, 'stepFrame', [-1]],
  [{ type: 'stepMs', sign: 1 }, 'stepBy', [1]],
  [{ type: 'setRate', rate: 0.5 }, 'setRate', [0.5]],
  [{ type: 'selectVideo', id: 'v2' }, 'selectVideo', ['v2']],
  [{ type: 'selectMoment', id: 'm' }, 'selectMoment', ['m']],
  [{ type: 'playMoment', id: 'm' }, 'playMoment', ['m']],
  [{ type: 'playAll' }, 'playAll', []],
  [{ type: 'stopPlaylist' }, 'stopPlaylist', []],
  [{ type: 'markIn' }, 'markIn', []],
  [{ type: 'markOut' }, 'markOut', []],
  [{ type: 'addMoment', title: 'Гол', tags: ['гол'] }, 'addMoment', ['Гол', ['гол']]],
  [{ type: 'quickTag', index: 2 }, 'quickTag', [2]],
  [{ type: 'drawStart' }, 'drawStart', []],
  [{ type: 'addShape', shape, frameKey: 'k' }, 'addShape', [shape, 'k']],
  [{ type: 'undoShape', frameKey: 'k' }, 'undoShape', ['k']],
  [{ type: 'clearShapes', frameKey: 'k' }, 'clearShapes', ['k']],
  [{ type: 'undo' }, 'undo', []],
  [{ type: 'redo' }, 'redo', []]
]

describe('команды пульта → действия', () => {
  it.each(cases)('%o', (cmd, action, args) => {
    const calls: Record<string, ReturnType<typeof vi.fn>> = {}
    const actions = new Proxy({} as RemoteActions, { get: (_t, k: string) => (calls[k] ??= vi.fn()) })
    runRemoteCommand(cmd, actions)
    expect(Object.keys(calls)).toEqual([action])
    expect(calls[action]).toHaveBeenCalledWith(...args)
  })
})
