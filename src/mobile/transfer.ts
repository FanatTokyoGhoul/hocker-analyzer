import type { Project } from '../shared/types'

/**
 * Перенос проекта между телефоном и компьютером.
 * На телефоне видео — это content://… от системного выбора файлов, на компьютере — путь к файлу.
 * В файл проекта телефон пишет только имя видео: компьютер находит его рядом с проектом,
 * а если не нашёл — предлагает «Указать видео». Обратно: имя (или путь с компьютера) → content://
 * по реестру видео, которые уже выбирали на этом телефоне.
 */

/** Имя видео → content:// (последнее выбранное с таким именем). */
export type VideoRegistry = Record<string, string>

export const isContentUri = (path: string): boolean => path.startsWith('content://')

/** Имя файла из пути Windows или POSIX. */
export const fileNameOf = (path: string): string => path.split(/[\\/]/).pop() || path

/** Проект для записи в файл: вместо content:// — имена видео. */
export function projectForFile(project: Project, nameOf: (path: string) => string): Project {
  const videos = project.videos.map((v) => (isContentUri(v.path) ? { ...v, path: nameOf(v.path) } : v))
  return { ...project, videos, videoPath: videos[0]?.path ?? project.videoPath }
}

/**
 * Проект из файла: известные телефону видео получают content://, остальные остаются как есть (их надо указать).
 * content:// из файла не доверяем — файл мог прийти от кого угодно; свои телефон в файл не пишет.
 */
export function projectFromFile(project: Project, registry: VideoRegistry): Project {
  const videos = project.videos.map((v) => {
    const name = fileNameOf(v.path)
    const uri = registry[name]
    return uri ? { ...v, path: uri } : isContentUri(v.path) ? { ...v, path: name } : v
  })
  return { ...project, videos, videoPath: videos[0]?.path ?? project.videoPath }
}

/** Имя файла проекта по имени первого видео: «VID_20261018.hockey.json». */
export function projectFileName(project: Project, nameOf: (path: string) => string): string {
  const first = project.videos[0]
  const base = first ? fileNameOf(nameOf(first.path)).replace(/\.[^.]+$/, '') : 'матч'
  return `${base || 'матч'}.hockey.json`
}
