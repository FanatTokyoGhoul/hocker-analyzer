import { useCallback, useEffect, useState } from 'react'
import type { ExportProgress, Moment, Project, ProjectVideo, VideoInfo } from '../../../shared/types'
import { errorText } from '../lib/errors'
import { buildExportRequest, type ExportOptions } from '../lib/exportRequest'

type Options = {
  project: Project | null
  /** Видео, которые удалось открыть: моменты ищутся только в них. */
  playable: ProjectVideo[]
  activeId: string
  /** Уже открытое видео — его не нужно заново опрашивать ffprobe. */
  info: VideoInfo | null
}

export type Exporter = {
  busy: boolean
  progress: ExportProgress | null
  /** Пути готовых файлов. */
  result: string[] | null
  error: string | null
  run(moments: Moment[], options: ExportOptions, name: string): Promise<void>
  /** Закрыли диалог — старый результат при следующем открытии не показываем. */
  reset(): void
  cancel(): void
}

/** Экспорт клипов: подготовка картинок в рендерере, кодирование в main, прогресс и результат для диалога. */
export function useExport({ project, playable, activeId, info }: Options): Exporter {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [result, setResult] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => window.api.onExportProgress(setProgress), [])

  const run = useCallback(
    async (moments: Moment[], options: ExportOptions, name: string) => {
      if (!project) return
      setBusy(true)
      setProgress(null)
      setResult(null)
      setError(null)
      try {
        const { request, skipped } = await buildExportRequest(
          project,
          moments,
          options,
          async (v) => {
            const meta = v.id === activeId && info ? info : await window.api.probeVideo(v.path)
            return { width: meta.width, height: meta.height, fps: meta.fps }
          },
          activeId,
          name,
          playable
        )
        const res = await window.api.exportClips(request)
        if (res) {
          setResult(res.paths)
          if (skipped) setError(`Пропущено моментов вне открытых видео: ${skipped}`)
        }
      } catch (e) {
        setError(errorText(e))
      } finally {
        setBusy(false)
        setProgress(null)
      }
    },
    [project, activeId, info, playable]
  )

  const reset = useCallback(() => {
    setResult(null)
    setError(null)
  }, [])
  const cancel = useCallback(() => void window.api.cancelExport(), [])

  return { busy, progress, result, error, run, reset, cancel }
}
