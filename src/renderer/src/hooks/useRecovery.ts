import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project, Recovery } from '../../../shared/types'

/** Через сколько после правки пишется черновик для восстановления. */
const RECOVERY_DELAY_MS = 3000

type Options = {
  project: Project | null
  dirty: boolean
  projectPath: string | null
  projectForDisk(p: Project): Project
  confirmDiscard(): Promise<boolean>
  loadProject(p: Project, path: string | null, missingVideos: string[], restored: boolean): void
  notify(msg: string): void
}

/**
 * Автосохранение черновика (profile/recovery.json) и восстановление после сбоя.
 * Пока пользователь не решил судьбу найденного черновика, новый не пишем — иначе затрём его.
 */
export function useRecovery({ project, dirty, projectPath, projectForDisk, confirmDiscard, loadProject, notify }: Options) {
  const [recovery, setRecovery] = useState<Recovery | null>(null)
  const [resolved, setResolved] = useState(false)
  const cb = useRef({ confirmDiscard, loadProject, notify })
  cb.current = { confirmDiscard, loadProject, notify }

  useEffect(() => {
    let cancelled = false
    window.api
      .readRecovery()
      .then((r) => {
        if (cancelled) return
        if (r) setRecovery(r)
        else setResolved(true)
      })
      .catch(() => !cancelled && setResolved(true))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!resolved) return
    if (!dirty || !project) return window.api.writeRecovery(null)
    const t = window.setTimeout(
      () => window.api.writeRecovery({ savedAt: Date.now(), projectPath, project: projectForDisk(project) }),
      RECOVERY_DELAY_MS
    )
    return () => window.clearTimeout(t)
  }, [project, dirty, projectPath, resolved, projectForDisk])

  const restore = useCallback(async () => {
    if (!recovery || !(await cb.current.confirmDiscard())) return
    cb.current.loadProject(recovery.project, recovery.projectPath, recovery.missingVideos, true)
    setRecovery(null)
    setResolved(true)
    cb.current.notify('Работа восстановлена — сохраните проект (Ctrl+S)')
  }, [recovery])

  const discard = useCallback(() => {
    window.api.writeRecovery(null)
    setRecovery(null)
    setResolved(true)
  }, [])

  return { recovery, restore, discard }
}
