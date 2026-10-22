import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Moment } from '../../shared/types'
import { pushRecentColor } from '../../shared/settings'
import { AppDialogs, type Dialog } from './components/AppDialogs'
import { Btn } from './components/Btn'
import { DrawMenu } from './components/DrawMenu'
import type { Tool } from './components/DrawingLayer'
import { HoldOverlay } from './components/HoldOverlay'
import { MomentsPanel } from './components/MomentsPanel'
import { RemoteMenu } from './components/RemoteMenu'
import { StageBanner } from './components/StageBanner'
import { Timeline } from './components/Timeline'
import { Toolbar } from './components/Toolbar'
import { Transport } from './components/Transport'
import { VideoBar } from './components/VideoBar'
import { VideoStage } from './components/VideoStage'
import { useDrawingStops } from './hooks/useDrawingStops'
import { useExport } from './hooks/useExport'
import { useFrameDrawing } from './hooks/useFrameDrawing'
import { useFullscreen } from './hooks/useFullscreen'
import { useIdle } from './hooks/useIdle'
import { useMoments } from './hooks/useMoments'
import { usePlayback } from './hooks/usePlayback'
import { usePlayerHotkeys } from './hooks/usePlayerHotkeys'
import { usePlaylist } from './hooks/usePlaylist'
import { useProjectFiles } from './hooks/useProjectFiles'
import { useRecovery } from './hooks/useRecovery'
import { useRemote } from './hooks/useRemote'
import { useSettings } from './hooks/useSettings'
import { useToast } from './hooks/useToast'
import { useVideoClock } from './hooks/useVideoClock'
import { useVideoSources } from './hooks/useVideoSources'
import { drawingTimes } from './lib/drawingStops'
import type { ExportOptions, ExportScope } from './lib/exportRequest'
import { NO_ZOOM, type ZoomView } from './lib/geometry'
import { newId } from './lib/ids'
import { baseName, fileName } from './lib/paths'
import { drawingVideoId, initialProjectState, projectReducer, redoLabel, undoLabel } from './lib/projectState'
import { runRemoteCommand } from './lib/remoteCommands'
import { buildRemoteState, remoteFrameKey } from './lib/remoteState'
import { locateMoment } from './lib/videos'

type FloatingMenu = 'draw' | 'remote' | null

export default function App(): React.JSX.Element {
  const [state, dispatch] = useReducer(projectReducer, initialProjectState)
  const { project, projectPath, dirty } = state
  const projectName = project ? fileName(projectPath ?? project.videoPath) : null

  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const { toast, notify, dismiss: dismissToast } = useToast()
  const [settings, updateSettings, settingsFile] = useSettings()
  const { stepMs, color, quickTags, recentColors } = settings
  const [dialog, setDialog] = useState<Dialog>(null)
  const [menu, setMenu] = useState<FloatingMenu>(null)
  const [tool, setTool] = useState<Tool>('none')
  const [zoom, setZoom] = useState<ZoomView>(NO_ZOOM)
  const [viewer, setViewer] = useState<HTMLElement | null>(null)
  const [fullscreen, toggleFullscreen] = useFullscreen(viewer)

  // плейлист и остановки создаются позже (им нужно видео), поэтому видео-хук зовёт их через ref
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
  const { videos, playable, activeVideo, activeId, offset, info, converting, switchVideo, projectForDisk } = sources

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
  // stop и start стабильны, а весь объект плейлиста меняется на каждом шаге «проиграть все»
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
  // freeze и release стабильны, а весь stops меняется на каждой остановке
  const { freeze, release, hold } = stops
  const continueHold = useCallback(() => release(true), [release])
  // в полном экране во время воспроизведения панели прячутся, пока не шевельнёшь мышью
  const idle = useIdle(viewer, fullscreen && !clock.paused)

  useEffect(() => {
    window.api.setDirty(dirty)
    window.api.setTitle(projectName ? `${dirty ? '• ' : ''}${projectName} — Hockey Analyzer` : 'Hockey Analyzer')
  }, [dirty, projectName])

  // ---------- воспроизведение и моменты ----------

  /** Текущее время проекта. */
  const now = useCallback(() => (video?.currentTime ?? 0) + offset, [video, offset])
  const { seek, togglePlay, stepFrame, stepBy, setRate } = usePlayback({ video, stopPlaylist, hold, release, fps, duration, stepMs })

  const {
    draft,
    tagFilter,
    setTagFilter,
    allTags,
    visibleMoments,
    changeDraft,
    markIn,
    markOut,
    addMoment,
    addFromPanel,
    quickTag,
    quickTagAt,
    selectMoment,
    selectMomentById,
    playOne,
    playMomentById,
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
    notify
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
    ready: !!info && !converting,
    // в «недавние» попадают цвета, которыми действительно рисовали, а не все промежуточные из пипетки
    onColorUsed
  })
  const { activeMoment, canDraw } = drawing
  const pickColor = useCallback((c: string) => updateSettings({ color: c }), [updateSettings])

  // ---------- экспорт ----------

  const exporter = useExport({ project, playable, activeId, info })
  const exportCounts = useMemo(
    () => ({ current: activeMoment ? 1 : 0, visible: visibleMoments.length, all: moments.length }),
    [activeMoment, visibleMoments, moments]
  )
  const runExport = useCallback(
    (scope: ExportScope, options: ExportOptions) => {
      if (!project) return
      const list = scope === 'current' ? (activeMoment ? [activeMoment] : []) : scope === 'visible' ? visibleMoments : moments
      const name =
        scope === 'current' && activeMoment
          ? activeMoment.title
          : `${baseName(projectPath ?? project.videoPath)} — ${scope === 'visible' ? `#${tagFilter}` : 'подборка'}`
      void exporter.run(list, options, name)
    },
    [project, activeMoment, visibleMoments, moments, projectPath, tagFilter, exporter]
  )

  // ---------- пульт с телефона ----------

  const frameKey = remoteFrameKey(activeId, info?.path, drawing.frame)
  /** Пульт не управляет, пока на компьютере открыто окно или идёт конвертация — как и клавиатура. */
  const remoteNotice = converting ? 'Идёт конвертация видео' : dialog ? 'На компьютере открыто окно' : null
  /** Фигура с телефона — только на тот кадр, который он видел (ключ обязателен), и только когда рисовать можно. */
  const onShownFrame = (key: string): boolean => canDraw && key === frameKey
  const remote = useRemote(
    () => ({
      state: buildRemoteState({
        title: projectName ?? '',
        info,
        clock,
        fps,
        videos,
        activeId,
        moments,
        activeMomentId: activeMoment?.id ?? null,
        playlist: playlist.view,
        hold: !!hold,
        draft: { start: draft.start, end: draft.end },
        quickTags,
        canDraw,
        drawHint: canDraw ? null : converting ? 'Идёт конвертация видео' : (drawing.hint ?? 'Видео не открыто'),
        shapes: drawing.shapes,
        color,
        recentColors,
        stepMs,
        notice: remoteNotice
      }),
      // ffmpeg с точной перемоткой берёт первый кадр не раньше -ss: полкадра до начала — это ровно текущий кадр
      frame: info && clock.paused ? { videoPath: info.path, time: Math.max(0, (drawing.frame - 0.5) / fps) } : null
    }),
    (cmd) => {
      if (remoteNotice) return
      runRemoteCommand(cmd, {
        togglePlay,
        release: continueHold,
        stepFrame,
        stepBy,
        setRate,
        selectVideo: sources.selectVideo,
        selectMoment: selectMomentById,
        playMoment: playMomentById,
        playAll,
        stopPlaylist,
        markIn,
        markOut,
        addMoment: (title, tags) => addMoment({ title, tags }),
        quickTag: quickTagAt,
        drawStart: freeze,
        // id фигуры назначаем сами: с телефона мог прийти уже занятый
        addShape: (shape, key) => onShownFrame(key) && drawing.addShape({ ...shape, id: newId('s') }),
        undoShape: (key) => onShownFrame(key) && drawing.undoShape(),
        clearShapes: (key) => onShownFrame(key) && drawing.clearShapes(),
        undo,
        redo
      })
    }
  )

  // ---------- горячие клавиши ----------

  usePlayerHotkeys({
    dialog: dialog ? (dialog.kind === 'board' ? 'board' : 'other') : null,
    waitingKey: hold?.mode === 'key',
    ready: !!info,
    release: continueHold,
    save: (saveAs) => void files.saveProject(saveAs),
    open: () => void files.openProject(),
    undo,
    redo,
    quickTag: quickTagAt,
    togglePlay,
    stepFrame,
    stepBy,
    markIn,
    markOut,
    addMoment: addFromPanel,
    escape: () => {
      setMenu(null)
      setTool('none')
    },
    toggleFullscreen,
    resetZoom: () => setZoom(NO_ZOOM),
    setRate,
    setTool
  })

  // ---------- разметка ----------

  // всплывающие окна рендерим внутрь полноэкранного элемента, иначе их не видно
  const overlayRoot = fullscreen && viewer ? viewer : document.body
  const playingMoment = playlist.view ? moments.find((m) => m.id === playlist.view!.ids[playlist.view!.index]) : null
  return (
    <div className="app">
      <Toolbar
        name={projectName}
        title={project?.videoPath}
        dirty={dirty}
        undoLabel={undoLabel(state)}
        redoLabel={redoLabel(state)}
        hasMoments={moments.length > 0}
        onUndo={undo}
        onRedo={redo}
        onOpenVideo={files.openVideo}
        onOpenProject={files.openProject}
        onStats={() => setDialog({ kind: 'stats' })}
        onExport={() => {
          video?.pause()
          setDialog({ kind: 'export' })
        }}
        onSave={(saveAs) => void files.saveProject(saveAs)}
        onSettings={openSettings}
      />

      <main className="workspace">
        <section ref={setViewer} className={`viewer${fullscreen ? ' is-fullscreen' : ''}${idle ? ' is-idle' : ''}`}>
          {project && (
            <VideoBar
              videos={videos}
              activeId={activeId}
              missing={sources.missingIds}
              disabled={!!converting}
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
            onDrawStart={freeze}
            onDropFile={files.dropVideo}
            onVideoError={sources.reportPlaybackError}
            onClickVideo={togglePlay}
            hint={hold || tool === 'none' ? null : drawing.hint}
            overlay={
              <StageBanner
                recovery={recovery.recovery}
                onRestore={recovery.restore}
                onDiscard={recovery.discard}
                converting={converting}
                missingVideo={sources.missingActive}
                onRelocate={sources.relocateVideo}
                info={info}
                playbackError={sources.playbackError}
                vfrDismissed={sources.vfrDismissed}
                onConvert={sources.convertVideo}
                onDismissVfr={sources.dismissVfr}
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
                    onTool={setTool}
                    onColor={pickColor}
                    onUndo={drawing.undoShape}
                    onClear={drawing.clearShapes}
                  />
                  <RemoteMenu remote={remote} open={menu === 'remote'} onOpenChange={(open) => setMenu(open ? 'remote' : null)} />
                </div>
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
              // видео проекта грузится (переключили вкладку) или не найдено — без заставки
              project ? null : (
                <div className="empty">
                  <div className="empty-mark">🏒</div>
                  <h2>Hockey Analyzer</h2>
                  <p className="muted">Перетащите сюда видео матча или</p>
                  <div className="empty-actions">
                    <Btn variant="primary" onClick={files.openVideo}>
                      Открыть видео
                    </Btn>
                    <Btn onClick={files.openProject}>Открыть проект</Btn>
                  </div>
                  <p className="muted small">Горячие клавиши — в настройках ⚙</p>
                </div>
              )
            }
          />
          <div className="controls">
            <Timeline
              duration={duration}
              time={clock.time}
              moments={timelineMoments}
              draft={timelineDraft}
              activeId={activeMoment?.id ?? null}
              onSeek={seek}
              onSelectMoment={selectTimelineMoment}
            />
            <Transport
              clock={clock}
              fps={fps}
              stepMs={stepMs}
              fullscreen={fullscreen}
              onTogglePlay={togglePlay}
              onStepFrame={stepFrame}
              onStepMs={stepBy}
              onRate={setRate}
              onToggleFullscreen={toggleFullscreen}
            />
          </div>
        </section>

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
          onPlayAll={playAll}
          onStopPlaylist={stopPlaylist}
          onSelect={selectMoment}
          onPlayOne={playOne}
          onUpdate={updateMoment}
          onSetBoundToNow={setBoundToNow}
          onDelete={deleteMoment}
          onBoard={openBoard}
          quickTags={settings.quickTags}
          onQuickTag={quickTag}
          onConfigureQuickTags={openSettings}
        />
      </main>

      {dialog &&
        createPortal(
          <AppDialogs
            dialog={dialog}
            onClose={() => setDialog(null)}
            project={project}
            dispatch={dispatch}
            settings={settings}
            settingsFile={settingsFile}
            onSettingsChange={updateSettings}
            info={info}
            canOptimize={!!info && !info.needsConversion && !converting}
            onOptimize={() => void sources.convertVideo()}
            videos={videos}
            activeId={activeId}
            positionOf={sources.positionOf}
            onSyncVideos={sources.syncVideos}
            onRemoveVideo={sources.removeVideo}
            now={clock.time + offset}
            onSaveCsv={files.saveCsv}
            exporter={exporter}
            exportCounts={exportCounts}
            currentMoment={activeMoment}
            tagFilter={tagFilter}
            onExport={runExport}
            onColor={pickColor}
          />,
          overlayRoot
        )}

      {toast &&
        createPortal(
          <div className="toast" role="status" onClick={dismissToast}>
            {toast}
          </div>,
          overlayRoot
        )}
    </div>
  )
}
