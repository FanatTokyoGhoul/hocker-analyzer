import { useCallback, type Dispatch } from 'react'
import type { Project, VideoInfo } from '../../../shared/types'
import { errorText } from '../lib/errors'
import { fileName } from '../lib/paths'
import type { ProjectAction } from '../lib/projectState'

type Options = {
  project: Project | null
  projectPath: string | null
  dirty: boolean
  dispatch: Dispatch<ProjectAction>
  /** Сбросить вид (плейлист, черновик, зум) перед сменой проекта. */
  resetView(): void
  startProject(v: VideoInfo): void
  loadProject(p: Project, path: string | null, missingVideos: string[], restored: boolean): void
  projectForDisk(p: Project): Project
  notify(msg: string): void
}

/** Открытие видео и проектов, сохранение проекта и CSV — с подтверждением потери несохранённого. */
export function useProjectFiles({ project, projectPath, dirty, dispatch, resetView, startProject, loadProject, projectForDisk, notify }: Options) {
  const confirmDiscard = useCallback(
    async () => !dirty || window.api.confirm('Несохранённые изменения будут потеряны', 'Продолжить без сохранения?'),
    [dirty]
  )

  const startNewProject = useCallback(
    (v: VideoInfo) => {
      resetView()
      startProject(v)
    },
    [resetView, startProject]
  )
  const openLoadedProject = useCallback(
    (p: Project, path: string | null, missingVideos: string[], restored: boolean) => {
      resetView()
      loadProject(p, path, missingVideos, restored)
    },
    [resetView, loadProject]
  )

  const openVideo = useCallback(async () => {
    try {
      if (!(await confirmDiscard())) return
      const v = await window.api.openVideoDialog()
      if (v) startNewProject(v)
    } catch (e) {
      notify(errorText(e))
    }
  }, [confirmDiscard, startNewProject, notify])

  const dropVideo = useCallback(
    async (file: File) => {
      try {
        if (!(await confirmDiscard())) return
        startNewProject(await window.api.registerDroppedFile(file))
      } catch (e) {
        notify(errorText(e))
      }
    },
    [confirmDiscard, startNewProject, notify]
  )

  const openProject = useCallback(async () => {
    try {
      if (!(await confirmDiscard())) return
      const opened = await window.api.openProjectDialog()
      if (opened) openLoadedProject(opened.project, opened.path, opened.missingVideos, false)
    } catch (e) {
      notify(`Не удалось открыть проект: ${errorText(e)}`)
    }
  }, [confirmDiscard, openLoadedProject, notify])

  const saveProject = useCallback(
    async (saveAs: boolean) => {
      if (!project) return
      try {
        const path = await window.api.saveProject(saveAs ? null : projectPath, projectForDisk(project))
        if (path) {
          dispatch({ type: 'saved', path, project })
          notify(`Сохранено: ${fileName(path)}`)
        }
      } catch (e) {
        notify(`Не удалось сохранить: ${errorText(e)}`)
      }
    },
    [project, projectPath, projectForDisk, dispatch, notify]
  )

  const saveCsv = useCallback(
    async (name: string, content: string) => {
      try {
        const path = await window.api.saveTextFile(name, content, 'csv')
        if (path) notify(`Сохранено: ${fileName(path)}`)
      } catch (e) {
        notify(`Не удалось сохранить: ${errorText(e)}`)
      }
    },
    [notify]
  )

  return { confirmDiscard, startNewProject, openLoadedProject, openVideo, dropVideo, openProject, saveProject, saveCsv }
}
