export const SPEED_PRESETS = [0.25, 0.5, 0.75, 1] as const
export const MIN_RATE = 0.1
export const MAX_RATE = 1

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export function frameIndex(time: number, fps: number): number {
  // небольшой эпсилон — currentTime после seek бывает чуть меньше границы кадра
  return Math.floor(time * fps + 1e-6)
}

/**
 * Время для шага на `delta` кадров. Ставим середину целевого кадра: так seek
 * гарантированно попадает в нужный кадр, несмотря на округление таймстемпов.
 */
export function stepFrameTime(time: number, fps: number, delta: number, duration: number): number {
  const target = frameIndex(time, fps) + delta
  const lastFrame = duration > 0 ? Math.max(0, Math.ceil(duration * fps) - 1) : Infinity
  return (clamp(target, 0, lastFrame) + 0.5) / fps
}

export function stepMsTime(time: number, ms: number, duration: number): number {
  return clamp(time + ms / 1000, 0, duration > 0 ? duration : Infinity)
}

export function clampRate(rate: number): number {
  return Math.round(clamp(rate, MIN_RATE, MAX_RATE) * 100) / 100
}

/** 83.456 → "1:23.456"; с часами — "1:01:23.456". */
export function formatTime(seconds: number, withMs = true): string {
  const s = Math.max(0, seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const ms = Math.floor((s * 1000) % 1000)
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  const base = `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
  return withMs ? `${base}.${String(ms).padStart(3, '0')}` : base
}

/** Понимает "83.5", "1:23", "1:23.5", "1:01:23". null — не удалось разобрать. */
export function parseTime(input: string): number | null {
  const parts = input.trim().replace(',', '.').split(':')
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0)
}
