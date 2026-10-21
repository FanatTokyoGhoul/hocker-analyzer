/** Имя файла из пути (Windows и POSIX). */
export const fileName = (p: string): string => p.split(/[\\/]/).pop() ?? p

/** Имя файла без расширения. */
export const baseName = (p: string): string => fileName(p).replace(/\.[^.]+$/, '')
