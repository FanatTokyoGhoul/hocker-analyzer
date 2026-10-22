import type { Dispatch } from 'react'
import type { Moment, Project, ProjectVideo, VideoInfo } from '../../../shared/types'
import type { Settings } from '../../../shared/settings'
import type { Exporter } from '../hooks/useExport'
import type { ExportOptions, ExportScope } from '../lib/exportRequest'
import type { ProjectAction } from '../lib/projectState'
import { BoardDialog } from './BoardDialog'
import { ExportDialog } from './ExportDialog'
import { SettingsDialog } from './SettingsDialog'
import { StatsDialog } from './StatsDialog'
import { VideosDialog } from './VideosDialog'

export type Dialog = { kind: 'settings' } | { kind: 'stats' } | { kind: 'export' } | { kind: 'videos' } | { kind: 'board'; momentId: string } | null

type Props = {
  dialog: Dialog
  onClose(): void
  project: Project | null
  dispatch: Dispatch<ProjectAction>
  settings: Settings
  settingsFile: string | null
  onSettingsChange(patch: Partial<Settings>): void
  info: VideoInfo | null
  canOptimize: boolean
  onOptimize(): void
  videos: ProjectVideo[]
  activeId: string
  positionOf(id: string): number
  onSyncVideos(targetId: string, refId: string): void
  onRemoveVideo(id: string): void
  /** Текущее время проекта — для начал периодов. */
  now: number
  onSaveCsv(name: string, content: string): void
  exporter: Exporter
  exportCounts: Record<ExportScope, number>
  currentMoment: Moment | null
  tagFilter: string | null
  onExport(scope: ExportScope, options: ExportOptions): void
  onColor(color: string): void
}

/** Модальные окна приложения: настройки, статистика, экспорт, видео проекта, схема площадки. */
export function AppDialogs(p: Props): React.JSX.Element | null {
  const { dialog, onClose, project, dispatch, settings } = p
  const moments = project?.moments ?? []
  if (!dialog) return null
  switch (dialog.kind) {
    case 'settings':
      return (
        <SettingsDialog
          settings={settings}
          settingsFile={p.settingsFile}
          info={p.info}
          canOptimize={p.canOptimize}
          onChange={p.onSettingsChange}
          onOptimize={() => {
            onClose()
            p.onOptimize()
          }}
          onClose={onClose}
        />
      )
    case 'stats':
      return (
        <StatsDialog
          moments={moments}
          videos={p.videos}
          periods={project?.periods ?? []}
          now={p.now}
          onPeriodsChange={(periods) => dispatch({ type: 'setPeriods', periods })}
          onSaveCsv={p.onSaveCsv}
          onClose={onClose}
        />
      )
    case 'export':
      return (
        <ExportDialog
          counts={p.exportCounts}
          currentTitle={p.currentMoment?.title ?? null}
          tagFilter={p.tagFilter}
          hasBoards={moments.some((m) => !!m.board?.length)}
          defaultHold={settings.holdSeconds}
          busy={p.exporter.busy}
          progress={p.exporter.progress}
          result={p.exporter.result}
          error={p.exporter.error}
          onExport={p.onExport}
          onCancel={p.exporter.cancel}
          onReveal={(path) => void window.api.revealFile(path)}
          onClose={() => {
            onClose()
            p.exporter.reset()
          }}
        />
      )
    case 'videos':
      return (
        <VideosDialog
          videos={p.videos}
          activeId={p.activeId}
          positions={new Map(p.videos.map((v) => [v.id, p.positionOf(v.id)]))}
          onUpdate={(id, patch) => dispatch({ type: 'updateVideo', id, patch })}
          onSync={p.onSyncVideos}
          onRemove={p.onRemoveVideo}
          onClose={onClose}
        />
      )
    case 'board': {
      const moment = moments.find((m) => m.id === dialog.momentId)
      return moment ? (
        <BoardDialog
          moment={moment}
          color={settings.color}
          recentColors={settings.recentColors}
          onColor={p.onColor}
          onChange={(shapes) => dispatch({ type: 'setBoard', momentId: moment.id, shapes })}
          onClose={onClose}
        />
      ) : null
    }
  }
}
