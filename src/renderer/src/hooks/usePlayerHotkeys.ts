import type { Tool } from '../components/DrawingLayer'
import { TOOLS } from '../components/DrawMenu'
import { SPEED_PRESETS } from '../lib/time'
import { useHotkeys } from './useHotkeys'

const TOOL_KEYS: Record<string, Tool> = Object.fromEntries(TOOLS.map((t) => [t.code, t.id]))
const DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9']
const PLAYER_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'KeyI', 'KeyO', 'Enter', 'NumpadEnter', 'Escape', 'KeyF', 'Digit0', ...DIGITS, ...Object.keys(TOOL_KEYS)])
const MODIFIERS = ['Shift', 'Control', 'Alt', 'Meta']

export type PlayerHotkeys = {
  /** Открыт диалог: клавиши не управляют видео под ним. В схеме площадки работает только история. */
  dialog: 'board' | 'other' | null
  /** Остановка на рисунке ждёт клавишу. */
  waitingKey: boolean
  /** Видео открыто и загружено. */
  ready: boolean
  release(): void
  save(saveAs: boolean): void
  open(): void
  undo(): void
  redo(): void
  /** false — кнопки с таким номером нет (клавиша не перехватывается). */
  quickTag(index: number): boolean
  togglePlay(): void
  stepFrame(delta: -1 | 1): void
  stepBy(sign: -1 | 1): void
  markIn(): void
  markOut(): void
  addMoment(): void
  /** Esc: выключить рисование (в полном экране Esc сам выходит из него). */
  escape(): void
  toggleFullscreen(): void
  resetZoom(): void
  setRate(rate: number): void
  setTool(tool: Tool): void
}

/**
 * Горячие клавиши плеера. Сопоставление по e.code (работает в русской раскладке).
 * Во время остановки «до нажатия клавиши» клавиши со своим действием выполняют его,
 * остальные (кроме одиночных модификаторов) продолжают просмотр.
 */
export function usePlayerHotkeys(a: PlayerHotkeys): void {
  useHotkeys((e) => {
    const mod = e.ctrlKey || e.metaKey
    if (a.dialog) {
      if (a.dialog === 'board' && mod && (e.code === 'KeyZ' || e.code === 'KeyY')) return e.shiftKey || e.code === 'KeyY' ? a.redo() : a.undo()
      return false
    }
    if (a.waitingKey && !mod && !PLAYER_KEYS.has(e.code) && !MODIFIERS.includes(e.key)) return a.release()
    if (mod) {
      if (e.code === 'KeyS') return a.save(e.shiftKey)
      if (e.code === 'KeyO') return a.open()
      if (e.code === 'KeyZ') return e.shiftKey ? a.redo() : a.undo()
      if (e.code === 'KeyY') return a.redo()
      return false
    }
    if (e.altKey || !a.ready) return false
    if (e.shiftKey && DIGITS.includes(e.code)) return a.quickTag(DIGITS.indexOf(e.code)) && undefined
    switch (e.code) {
      case 'Space':
        return a.togglePlay()
      case 'ArrowLeft':
      case 'ArrowRight': {
        const dir = e.code === 'ArrowLeft' ? -1 : 1
        return e.shiftKey ? a.stepBy(dir) : a.stepFrame(dir)
      }
      case 'KeyI':
        return a.markIn()
      case 'KeyO':
        return a.markOut()
      case 'Enter':
      case 'NumpadEnter':
        return a.addMoment()
      case 'Escape':
        return a.escape()
      case 'KeyF':
        return a.toggleFullscreen()
      case 'Digit0':
        return a.resetZoom()
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
      case 'Digit4':
        return a.setRate(SPEED_PRESETS[Number(e.code.slice(-1)) - 1])
    }
    if (TOOL_KEYS[e.code]) return a.setTool(TOOL_KEYS[e.code])
    return false
  })
}
