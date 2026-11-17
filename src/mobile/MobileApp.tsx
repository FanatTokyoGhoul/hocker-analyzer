import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { App as CapApp } from '@capacitor/app'
import type { Moment } from '../shared/types'
import { pushRecentColor } from '../shared/settings'
import { AppDialogs, type Dialog } from '../renderer/src/components/AppDialogs'
import { BoardsButton } from '../renderer/src/components/BoardsButton'
import { Btn } from '../renderer/src/components/Btn'
import { DrawMenu } from '../renderer/src/components/DrawMenu'
import type { Tool } from '../renderer/src/components/DrawingLayer'
import { HoldOverlay } from '../renderer/src/components/HoldOverlay'
import { MomentsPanel } from '../renderer/src/components/MomentsPanel'
import { StageBanner } from '../renderer/src/components/StageBanner'
import { Timeline } from '../renderer/src/components/Timeline'
import { VideoBar } from '../renderer/src/components/VideoBar'
import { VideoStage } from '../renderer/src/components/VideoStage'
import { useDrawingStops } from '../renderer/src/hooks/useDrawingStops'
import { useFrameDrawing } from '../renderer/src/hooks/useFrameDrawing'
import { useMoments } from '../renderer/src/hooks/useMoments'
import { usePlayback } from '../renderer/src/hooks/usePlayback'
import { usePlaylist } from '../renderer/src/hooks/usePlaylist'
import { useProjectFiles } from '../renderer/src/hooks/useProjectFiles'
import { useRecovery } from '../renderer/src/hooks/useRecovery'
import { useSettings } from '../renderer/src/hooks/useSettings'
import { useToast } from '../renderer/src/hooks/useToast'
import { useVideoClock } from '../renderer/src/hooks/useVideoClock'
import { useVideoSources } from '../renderer/src/hooks/useVideoSources'
import { useFullscreen } from '../renderer/src/hooks/useFullscreen'
import { drawingTimes } from '../renderer/src/lib/drawingStops'
import type { Exporter } from '../renderer/src/hooks/useExport'
import { errorText } from '../renderer/src/lib/errors'
import { NO_ZOOM, type ZoomView } from '../renderer/src/lib/geometry'
import { drawingVideoId, initialProjectState, projectReducer, redoLabel, undoLabel } from '../renderer/src/lib/projectState'
import { locateMoment } from '../renderer/src/lib/videos'
import { displayName, shareProject } from './mobileApi'
import { isIOS } from './native'
import { MobileTransport } from './MobileTransport'

type FloatingMenu = 'draw' | 'main' | null

/** Экспорта на телефоне нет — окну диалогов отдаём пустышку. */
const NO_EXPORTER: Exporter = {
  busy: false,
  progress: null,
  result: null,
  error: null,
  run: async () => undefined,
  cancel: () => undefined,
  reset: () => undefined
}
const NO_COUNTS = { current: 0, visible: 0, all: 0 }

/**
 * Hockey Analyzer на телефоне: те же проект, моменты, рисунки и схемы, что на компьютере.
 * Сверху видео, под ним управление и панель разметки; в ландшафте панель — так же под видео, прокручивается вниз.
 */
export default function MobileApp(): React.JSX.Element {
  const [state, dispatch] = useReducer(projectReducer, initialProjectState)
  const { project, projectPath, dirty } = state
  const projectName = project ? displayName(projectPath ?? project.videoPath) : null

  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const { toast, notify, dismiss: dismissToast } = useToast()
  const [settings, updateSettings] = useSettings()
  const { stepMs, color, quickTags, recentColors } = settings
  const [dialog, setDialog] = useState<Dialog>(null)
  const [menu, setMenu] = useState<FloatingMenu>(null)
  const [tool, setTool] = useState<Tool>('none')
  const [zoom, setZoom] = useState<ZoomView>(NO_ZOOM)
  /** Полный экран как в YouTube: только видео, тап по кадру показывает или прячет управление. */
  const [appRoot, setAppRoot] = useState<HTMLDivElement | null>(null)
  const [fsSignal, setFsSignal] = useState(0)
  const [fsChrome, setFsChrome] = useState(true)
  const [fullscreen] = useFullscreen(appRoot, { key: fsSignal })
  // Android WebView не рассылает fullscreenchange — сверяем состояние по резолву промиса
  const toggleFullscreen = useCallback(() => {
    const done = (): void => {
      setFsSignal((n) => n + 1)
      setFsChrome(true)
    }
    if (document.fullscreenElement) void document.exitFullscreen().then(done, done)
    else void appRoot?.requestFullscreen().then(done, done)
  }, [appRoot])

  const stopPlaylistRef = useRef<() => void>(() => undefined)
  const armStops = useRef<() => void>(() => undefined)

  const sources = useVideoSources({
    project,
    dispatch,
    video,
    notify,
    stopPlaylist: () => stopPlaylistRef.current(),
    beforeSeek: () => armStops.current(),
    onSwitch: () => setZoom(NO_ZOOM)
  })
  const { videos, playable, activeVideo, activeId, offset, info, switchVideo, projectForDisk } = sources

  const clock = useVideoClock(video)
  const fps = info?.fps ?? activeVideo?.fps ?? 30
  const duration = clock.duration || info?.duration || 0

  const moments = useMemo(() => project?.moments ?? [], [project])
  const playlist = usePlaylist(video, fps, moments, {
    videoId: activeId,
    offset,
    beforeSeek: () => armStops.current(),
    locate: (m) => {
      const v = locateMoment(playable, m, activeId)
      return v && { videoId: v.id, offset: v.offset }
    },
    switchTo: (id, local) => switchVideo(id, local, true)
  })
  const { stop: stopPlaylist, start: startPlaylist } = playlist
  stopPlaylistRef.current = stopPlaylist

  const stopTimes = useMemo(
    () => (project ? drawingTimes(moments, activeId, offset, (d) => drawingVideoId(project, d)) : []),
    [project, moments, activeId, offset]
  )
  const stops = useDrawingStops(video, stopTimes, fps, {
    mode: settings.holdMode,
    seconds: settings.holdSeconds,
    enabled: settings.holdScope === 'always' || playlist.view !== null
  })
  armStops.current = stops.arm
  const { freeze, release, hold } = stops
  const continueHold = useCallback(() => release(true), [release])

  const now = useCallback(() => (video?.currentTime ?? 0) + offset, [video, offset])
  const { seek, togglePlay, stepFrame, stepBy, setRate } = usePlayback({ video, stopPlaylist, hold, release, fps, duration, stepMs })

  // полный экран: управление видно 4 секунды после тапа; на паузе — пока не нажмёшь
  useEffect(() => {
    if (!fullscreen || !fsChrome || clock.paused) return
    const timer = setTimeout(() => setFsChrome(false), 4000)
    return () => clearTimeout(timer)
  }, [fullscreen, fsChrome, clock.paused])

  const {
    draft,
    tagFilter,
    setTagFilter,
    allTags,
    changeDraft,
    markIn,
    markOut,
    addFromPanel,
    quickTag,
    selectMoment,
    playOne,
    playAll,
    updateMoment,
    setBoundToNow,
    deleteMoment,
    timelineMoments,
    timelineDraft,
    selectTimelineMoment,
    reset: resetMoments
  } = useMoments({
    project,
    dispatch,
    now,
    ready: !!info,
    activeVideo,
    duration,
    playable,
    quickTags,
    stopPlaylist,
    startPlaylist,
    switchVideo,
    notify
  })

  // ---------- проект ----------

  const resetView = useCallback(() => {
    stopPlaylist()
    resetMoments()
    setZoom(NO_ZOOM)
  }, [stopPlaylist, resetMoments])

  const files = useProjectFiles({
    project,
    projectPath,
    dirty,
    dispatch,
    resetView,
    startProject: sources.startProject,
    loadProject: sources.loadProject,
    projectForDisk,
    notify,
    nameOf: displayName
  })
  const recovery = useRecovery({
    project,
    dirty,
    projectPath,
    projectForDisk,
    confirmDiscard: files.confirmDiscard,
    loadProject: files.openLoadedProject,
    notify
  })

  const undo = useCallback(() => {
    const label = undoLabel(state)
    if (!label) return notify('Отменять нечего')
    dispatch({ type: 'undo' })
    notify(`Отменено: ${label}`)
  }, [state, notify])
  const redo = useCallback(() => {
    const label = redoLabel(state)
    if (!label) return
    dispatch({ type: 'redo' })
    notify(`Повторено: ${label}`)
  }, [state, notify])

  const sendToComputer = useCallback(async () => {
    if (!project) return
    try {
      await shareProject(projectForDisk(project))
    } catch (e) {
      // закрыть окно «Поделиться» без выбора — не ошибка
      if (!/cancel/i.test(errorText(e))) notify(`Не удалось отправить: ${errorText(e)}`)
    }
  }, [project, projectForDisk, notify])

  const openBoard = useCallback(
    (m: Moment) => {
      freeze()
      setDialog({ kind: 'board', momentId: m.id })
    },
    [freeze]
  )
  const openSettings = useCallback(() => {
    freeze()
    setDialog({ kind: 'settings' })
  }, [freeze])
  const openVk = useCallback(() => {
    freeze()
    setDialog({ kind: 'vk' })
  }, [freeze])

  // ---------- рисование ----------

  const onColorUsed = useCallback((c: string) => updateSettings({ recentColors: pushRecentColor(recentColors, c) }), [recentColors, updateSettings])
  const drawing = useFrameDrawing({
    project,
    moments,
    dispatch,
    time: clock.time,
    paused: clock.paused,
    fps,
    offset,
    videoId: activeId,
    ready: !!info,
    onColorUsed
  })
  const { activeMoment, canDraw } = drawing
  const pickColor = useCallback((c: string) => updateSettings({ color: c }), [updateSettings])

  // WebView не показывает кадр, пока видео не запускали и не перематывали, — перемотка на месте показывает первый кадр
  useEffect(() => {
    if (!video) return
    const show = (): void => {
      if (video.paused && video.played.length === 0 && !video.seeking) video.currentTime = video.currentTime
    }
    if (video.readyState >= 1) show()
    else video.addEventListener('loadedmetadata', show, { once: true })
    return () => video.removeEventListener('loadedmetadata', show)
  }, [video])

  // ---------- кнопка «Назад» Android ----------

  // последние значения — в ref: слушатель регистрируется один раз
  const back = useRef({ dialog, menu, tool, fullscreen, exitFs: toggleFullscreen, dirty })
  back.current = { dialog, menu, tool, fullscreen, exitFs: toggleFullscreen, dirty }
  useEffect(() => {
    const sub = CapApp.addListener('backButton', () => {
      const b = back.current
      if (b.dialog) return setDialog(null)
      if (b.menu) return setMenu(null)
      if (b.tool !== 'none') return setTool('none')
      if (b.fullscreen) return b.exitFs()
      if (b.dirty && !window.confirm('Есть несохранённые изменения. Выйти? Черновик останется, его можно будет восстановить.')) return
      void CapApp.exitApp()
    })
    return () => void sub.then((s) => s.remove())
  }, [])

  // ---------- разметка ----------

  const playingMoment = playlist.view ? moments.find((m) => m.id === playlist.view!.ids[playlist.view!.index]) : null
  /** Кнопка «Моменты» в полном экране: выйти и прокрутить рабочую область к панели, как в портрете. */
  const showMoments = (): void => {
    toggleFullscreen()
    setTimeout(() => appRoot?.querySelector('.m-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350)
  }
  /** Выбор или запуск момента — скроллим к видео, чтобы было видно просмотр. */
  const atVideo = <T,>(fn: T): T =>
    ((...args: unknown[]) => {
      appRoot?.querySelector('.m-workspace')?.scrollTo({ top: 0, behavior: 'smooth' })
      ;(fn as (...a: unknown[]) => unknown)(...args)
    }) as T
  /** Тап в полном экране — по любой точке сцены, включая чёрные поля вокруг видео. */
  const tapStart = useRef<{ x: number; y: number } | null>(null)
  const tapStage = (e: React.MouseEvent): void => {
    if (tool !== 'none' || menu === 'draw') return
    const el = e.target as HTMLElement
    if (el.closest('button, a, input, textarea, select, .m-controls, .m-fs-bar, .banner, .draw-menu')) return
    const start = tapStart.current
    if (start && (Math.abs(e.clientX - start.x) > 12 || Math.abs(e.clientY - start.y) > 12)) return
    setFsChrome((v) => !v)
  }
  const menuItem = (label: string, action: () => void, disabled = false): React.JSX.Element => (
    <button
      type="button"
      className="m-menu-item"
      disabled={disabled}
      onClick={() => {
        setMenu(null)
        action()
      }}
    >
      {label}
    </button>
  )

  return (
    <div ref={setAppRoot} className={`m-app${fullscreen ? ' is-fullscreen' : ''}${fullscreen && !fsChrome ? ' is-chrome-hidden' : ''}`}>
      <header className="m-bar">
        <button type="button" className="m-bar-btn" aria-label="Меню" aria-expanded={menu === 'main'} onClick={() => setMenu(menu === 'main' ? null : 'main')}>
          ☰
        </button>
        <span className="m-title" title={projectName ?? undefined}>
          {dirty && <span className="m-dirty" aria-label="Есть несохранённые изменения" />}
          {projectName ?? 'Hockey Analyzer'}
        </span>
        <button type="button" className="m-bar-btn" aria-label="Отменить" disabled={!undoLabel(state)} onClick={undo}>
          ↶
        </button>
        <button type="button" className="m-bar-btn" aria-label="Повторить" disabled={!redoLabel(state)} onClick={redo}>
          ↷
        </button>
        <button type="button" className="m-bar-btn" aria-label="Сохранить" disabled={!project} onClick={() => void files.saveProject(false)}>
          💾
        </button>
      </header>

      {menu === 'main' && (
        <div className="m-menu-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setMenu(null)}>
          <nav className="m-menu" aria-label="Меню">
            {menuItem('Открыть видео', () => void files.openVideo())}
            {menuItem('Видео из VK', openVk)}
            {menuItem('Открыть проект', () => void files.openProject())}
            {menuItem('Сохранить', () => void files.saveProject(false), !project)}
            {menuItem('Сохранить как…', () => void files.saveProject(true), !project)}
            {menuItem('Отправить на компьютер', () => void sendToComputer(), !project)}
            <hr />
            {menuItem('Тактические схемы', () => setDialog({ kind: 'boards' }), !project)}
            {menuItem('Видео проекта', () => setDialog({ kind: 'videos' }), !project)}
            {menuItem('Настройки', openSettings)}
          </nav>
        </div>
      )}

      <main className="m-workspace">
        <section
          className="viewer m-viewer"
          onClick={fullscreen ? tapStage : undefined}
          onPointerDown={(e) => {
            tapStart.current = { x: e.clientX, y: e.clientY }
          }}
        >
          {fullscreen && (
            <div className="m-fs-bar">
              <button type="button" className="m-fs-moments" onClick={showMoments}>
                Моменты {moments.length}
              </button>
            </div>
          )}
          {project && (
            <VideoBar
              videos={videos}
              activeId={activeId}
              missing={sources.missingIds}
              disabled={false}
              onSelect={sources.selectVideo}
              onAdd={(kind) => void sources.addVideo(kind)}
              onManage={() => setDialog({ kind: 'videos' })}
            />
          )}
          <VideoStage
            info={info}
            videoRef={setVideo}
            shapes={drawing.shapes}
            canDraw={canDraw}
            tool={tool}
            color={color}
            onAddShape={drawing.addShape}
            onUpdateShape={drawing.updateShape}
            onDeleteShape={drawing.deleteShape}
            onDrawStart={freeze}
            onDropFile={() => undefined}
            onVideoError={sources.reportPlaybackError}
            onClickVideo={fullscreen ? () => {} : togglePlay}
            hint={hold || tool === 'none' ? null : drawing.hint}
            overlay={
              <StageBanner
                recovery={recovery.recovery}
                onRestore={recovery.restore}
                onDiscard={recovery.discard}
                converting={null}
                missingVideo={sources.missingActive}
                onRelocate={sources.relocateVideo}
                info={info}
                playbackError={sources.playbackError}
                vfrDismissed
                onConvert={() => undefined}
                onDismissVfr={() => undefined}
                canConvert={false}
                nameOf={displayName}
              />
            }
            zoom={zoom}
            onZoom={setZoom}
            floating={
              <>
                <div className="fab-stack">
                  <DrawMenu
                    open={menu === 'draw'}
                    tool={tool}
                    color={color}
                    recentColors={settings.recentColors}
                    shapeCount={drawing.shapeCount}
                    canEdit={canDraw}
                    onOpenChange={(open) => {
                      setMenu(open ? 'draw' : null)
                      if (open) freeze()
                    }}
                    onTool={(t) => {
                      setTool(t)
                      // инструмент выбран — меню не закрывает кадр, рисуем сразу
                      if (t !== 'none') setMenu(null)
                    }}
                    onColor={pickColor}
                    onUndo={drawing.undoShape}
                    onClear={drawing.clearShapes}
                  />
                  <BoardsButton
                    count={project?.boards?.length ?? 0}
                    onOpen={() => {
                      setMenu(null)
                      setDialog({ kind: 'boards' })
                    }}
                  />
                </div>
                {tool !== 'none' && (
                  <button type="button" className="m-tool-done" onPointerDown={(e) => e.stopPropagation()} onClick={() => setTool('none')}>
                    Готово
                  </button>
                )}
                {playingMoment && (
                  <div className="moment-caption" aria-live="polite">
                    <strong>{playingMoment.title}</strong>
                    {playingMoment.notes && <span>{playingMoment.notes}</span>}
                  </div>
                )}
                {hold && <HoldOverlay hold={hold} onContinue={continueHold} />}
              </>
            }
            empty={
              project ? null : (
                <div className="empty">
                  <div className="empty-mark">🏒</div>
                  <h2>Hockey Analyzer</h2>
                  <p className="muted">Разметка матча, рисунки и схемы. Потом отправьте проект на компьютер.</p>
                  <div className="empty-actions">
                    <Btn variant="primary" onClick={() => void files.openVideo()}>
                      Открыть видео
                    </Btn>
                    <Btn onClick={openVk}>Видео из VK</Btn>
                    <Btn onClick={() => void files.openProject()}>Открыть проект</Btn>
                  </div>
                </div>
              )
            }
          />
          <div className="controls m-controls">
            <Timeline
              duration={duration}
              time={clock.time}
              moments={timelineMoments}
              draft={timelineDraft}
              activeId={activeMoment?.id ?? null}
              src={null}
              onSeek={seek}
              onSelectMoment={selectTimelineMoment}
            />
            <MobileTransport
              clock={clock}
              stepMs={stepMs}
              onTogglePlay={togglePlay}
              onStepFrame={stepFrame}
              onStepMs={stepBy}
              onRate={setRate}
              fullscreen={fullscreen}
              onToggleFullscreen={isIOS ? undefined : toggleFullscreen}
            />
          </div>
        </section>

        <div className="m-panel">
          <MomentsPanel
            moments={moments}
            allTags={allTags}
            tagFilter={tagFilter}
            activeId={activeMoment?.id ?? null}
            draft={draft}
            playlist={playlist.view}
            holding={!!hold}
            disabled={!info}
            onDraftChange={changeDraft}
            onMarkIn={markIn}
            onMarkOut={markOut}
            onAdd={addFromPanel}
            onTagFilter={setTagFilter}
            onPlayAll={atVideo(playAll)}
            onStopPlaylist={stopPlaylist}
            onSelect={atVideo(selectMoment)}
            onPlayOne={atVideo(playOne)}
            onUpdate={updateMoment}
            onSetBoundToNow={setBoundToNow}
            onDelete={deleteMoment}
            onBoard={openBoard}
            quickTags={settings.quickTags}
            onQuickTag={quickTag}
            onConfigureQuickTags={openSettings}
          />
        </div>
      </main>

      {dialog &&
        createPortal(
          <AppDialogs
            dialog={dialog}
            onClose={() => setDialog(null)}
            project={project}
            dispatch={dispatch}
            settings={settings}
            settingsFile={null}
            onSettingsChange={updateSettings}
            info={info}
            canOptimize={false}
            onOptimize={() => undefined}
            videos={videos}
            activeId={activeId}
            positionOf={sources.positionOf}
            onSyncVideos={sources.syncVideos}
            onRemoveVideo={sources.removeVideo}
            now={clock.time + offset}
            onSaveCsv={() => undefined}
            confirmDiscard={files.confirmDiscard}
            onOpenDownloaded={(v) => {
              files.startNewProject(v)
              notify('Видео скачано из VK')
            }}
            exporter={NO_EXPORTER}
            exportCounts={NO_COUNTS}
            currentMoment={activeMoment}
            tagFilter={tagFilter}
            onExport={() => undefined}
            onColor={pickColor}
            mobile
          />,
          appRoot ?? document.body
        )}

      {toast &&
        createPortal(
          <div className="toast" role="status" onClick={dismissToast}>
            {toast}
          </div>,
          appRoot ?? document.body
        )}
    </div>
  )
}
