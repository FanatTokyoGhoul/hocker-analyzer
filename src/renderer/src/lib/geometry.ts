export type Size = { width: number; height: number }

/** Наибольший прямоугольник с пропорциями видео, вписанный в контейнер (как object-fit: contain). */
export function fitContain(container: Size, aspect: number): Size {
  if (container.width <= 0 || container.height <= 0 || !(aspect > 0)) return { width: 0, height: 0 }
  const width = Math.min(container.width, container.height * aspect)
  return { width: Math.floor(width), height: Math.floor(width / aspect) }
}

/**
 * Цифровой зум кадра: z — увеличение, tx/ty — сдвиг в долях кадра (≤ 0), чтобы вид переживал смену размера окна.
 * Видимая точка кадра p (0..1) = (p_контента · z + t).
 */
export type ZoomView = { z: number; tx: number; ty: number }

export const NO_ZOOM: ZoomView = { z: 1, tx: 0, ty: 0 }
export const MAX_ZOOM = 4

export function clampView(v: ZoomView): ZoomView {
  const z = Math.min(MAX_ZOOM, Math.max(1, v.z))
  const clampT = (t: number): number => Math.min(0, Math.max(1 - z, t))
  return { z, tx: clampT(v.tx), ty: clampT(v.ty) }
}

/** Увеличить в factor раз так, чтобы точка под курсором (px, py в долях кадра) осталась на месте. */
export function zoomAt(v: ZoomView, factor: number, px: number, py: number): ZoomView {
  const z = Math.min(MAX_ZOOM, Math.max(1, v.z * factor))
  const cx = (px - v.tx) / v.z
  const cy = (py - v.ty) / v.z
  return clampView({ z, tx: px - cx * z, ty: py - cy * z })
}

export function panBy(v: ZoomView, dx: number, dy: number): ZoomView {
  return clampView({ z: v.z, tx: v.tx + dx, ty: v.ty + dy })
}
