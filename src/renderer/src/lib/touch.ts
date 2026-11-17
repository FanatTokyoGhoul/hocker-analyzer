/** Основное устройство ввода — палец (телефон, планшет): крупнее зоны попадания, свои кнопки вместо клавиш. */
export const COARSE_POINTER = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

/** Допуски попадания пальцем, px: по фигуре и по ручке. */
export const TOUCH_HIT_SLOP = 18
export const TOUCH_HANDLE_SLOP = 24
