import type { RemoteCommand } from '../../../shared/remote'

/** Что умеет пульт — те же действия, что и клавиатура. */
export type RemoteActions = {
  togglePlay(): void
  release(): void
  stepFrame(delta: -1 | 1): void
  stepBy(sign: -1 | 1): void
  setRate(rate: number): void
  selectVideo(id: string): void
  selectMoment(id: string): void
  playMoment(id: string): void
  playAll(): void
  stopPlaylist(): void
  markIn(): void
  markOut(): void
  addMoment(title: string, tags: string[]): void
  quickTag(index: number): void
  drawStart(): void
  /** frameKey — кадр, который видел телефон; действие само проверит, что он ещё на экране. */
  addShape(shape: Extract<RemoteCommand, { type: 'addShape' }>['shape'], frameKey: string): void
  undoShape(frameKey: string): void
  clearShapes(frameKey: string): void
  undo(): void
  redo(): void
}

/** Выполнить команду телефона. Недоступное сейчас (нет видео, не пауза) действия игнорируют сами. */
export function runRemoteCommand(cmd: RemoteCommand, a: RemoteActions): void {
  switch (cmd.type) {
    case 'togglePlay':
      return a.togglePlay()
    case 'continue':
      return a.release()
    case 'stepFrame':
      return a.stepFrame(cmd.delta)
    case 'stepMs':
      return a.stepBy(cmd.sign)
    case 'setRate':
      return a.setRate(cmd.rate)
    case 'selectVideo':
      return a.selectVideo(cmd.id)
    case 'selectMoment':
      return a.selectMoment(cmd.id)
    case 'playMoment':
      return a.playMoment(cmd.id)
    case 'playAll':
      return a.playAll()
    case 'stopPlaylist':
      return a.stopPlaylist()
    case 'markIn':
      return a.markIn()
    case 'markOut':
      return a.markOut()
    case 'addMoment':
      return a.addMoment(cmd.title, cmd.tags)
    case 'quickTag':
      return a.quickTag(cmd.index)
    case 'drawStart':
      return a.drawStart()
    case 'addShape':
      return a.addShape(cmd.shape, cmd.frameKey)
    case 'undoShape':
      return a.undoShape(cmd.frameKey)
    case 'clearShapes':
      return a.clearShapes(cmd.frameKey)
    case 'undo':
      return a.undo()
    case 'redo':
      return a.redo()
    default: {
      // новая команда без обработчика — ошибка компиляции здесь
      const unhandled: never = cmd
      return unhandled
    }
  }
}
