import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ConvertProgress, ExportProgress, Moment, Project, ProjectVideo, Recovery, Shape, VideoInfo } from '../../shared/types'
import type { QuickTag } from '../../shared/settings'
import { pushRecentColor } from '../../shared/settings'
import { BoardDialog } from './components/BoardDialog'
import { Btn } from './components/Btn'
import { DrawMenu, TOOLS } from './components/DrawMenu'
import type { Tool } from './components/DrawingLayer'
import { ExportDialog } from './components/ExportDialog'
import { HoldOverlay } from './components/HoldOverlay'
import { MomentsPanel, type Draft, type MomentPatch } from './components/MomentsPanel'
import { SettingsDialog } from './components/SettingsDialog'
import { StatsDialog } from './components/StatsDialog'
import { Timeline } from './components/Timeline'
import { Transport } from './components/Transport'
import { VideoBar } from './components/VideoBar'
import { VideosDialog } from './components/VideosDialog'
import { VideoStage } from './components/VideoStage'
import { useDrawingStops } from './hooks/useDrawingStops'
import { useFullscreen } from './hooks/useFullscreen'
import { useHotkeys } from './hooks/useHotkeys'
import { useIdle } from './hooks/useIdle'
import { usePlaylist } from './hooks/usePlaylist'
import { useSettings } from './hooks/useSettings'
import { useVideoClock } from './hooks/useVideoClock'
import { drawingTimes } from './lib/drawingStops'
import { buildExportRequest, type ExportOptions, type ExportScope } from './lib/exportRequest'
import { NO_ZOOM, type ZoomView } from './lib/geometry'
import { newId } from './lib/ids'
import { baseName, fileName } from './lib/paths'
import {
  collectTags,
  drawingVideoId,
  findDrawingIndex,
  initialProjectState,
  momentAt,
  parseTags,
  projectReducer,
  redoLabel,
  undoLabel
} from './lib/projectState'
import { SPEED_PRESETS, clampRate, formatTime, frameIndex, stepFrameTime, stepMsTime } from './lib/time'
import { angleLabel, continuationOffset, locateMoment, nextPeriodLabel, syncOffset, videoCovers } from './lib/videos'

const EMPTY_DRAFT: Draft = { start: null, end: null, title: '', tags: '' }
const TOOL_KEYS: Record<string, Tool> = Object.fromEntries(TOOLS.map((t) => [t.code, t.id]))
const DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9']

const PLAYER_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'KeyI', 'KeyO', 'Enter', 'NumpadEnter', 'Escape', 'KeyF', 'Digit0', ...DIGITS, ...Object.keys(TOOL_KEYS)])
const isPlayerHotkey = (code: string): boolean => PLAYER_KEYS.has(code)
/** Через сколько после правки пишется черновик для восстановления. */
const RECOVERY_DELAY_MS = 3000

type Dialog = { kind: 'settings' } | { kind: 'stats' } | { kind: 'export' } | { kind: 'videos' } | { kind: 'board'; momentId: string } | null

const errorText = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export default function App(): React.JSX.Element {
  const [state, dispatch] = useReducer(projectReducer, initialProjectState)
  const { project, projectPath, dirty } = state
  const moments = useMemo(() => project?.moments ?? [], [project])

  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  /** Последнее загруженное видео: для какого видео проекта и какого пути оно открыто. */
  const [loaded, setLoaded] = useState<{ id: string; path: string; info: VideoInfo } | null>(null)
  const loadedRef = useRef(loaded)
  loadedRef.current = loaded
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null)
  /** Пути видео, которые не нашлись. По пути, а не по id: undo/redo пути сами «оживляют» видео. */
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set())
  /** Длительности видео, узнанные при открытии (в старых проектах их нет). */
  const [durations, setDurations] = useState<ReadonlyMap<string, number>>(new Map())
  /** Где стояло каждое видео, когда с него переключились, — для возврата и синхронизации. */
  const positions = useRef(new Map<string, number>())
  /** Перемотка, которую надо выполнить, когда загрузится только что выбранное видео. */
  const pendingSeek = useRef<{ local: number; play: boolean } | null>(null)

  const [playbackError, setPlaybackError] = useState(false)
  const [converting, setConverting] = useState<ConvertProgress | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [vfrDismissed, setVfrDismissed] = useState(false)
  const [recovery, setRecovery] = useState<Recovery | null>(null)
  /** Пока пользователь не решил судьбу найденного черновика, новый не пишем — иначе затрём его. */
  const [recoveryResolved, setRecoveryResolved] = useState(false)

  const [settings, updateSettings, settingsFile] = useSettings()
  const { stepMs, color } = settings
  const [dialog, setDialog] = useState<Dialog>(null)
  const [drawMenuOpen, setDrawMenuOpen] = useState(false)

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [tool, setTool] = useState<Tool>('none')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [zoom, setZoom] = useState<ZoomView>(NO_ZOOM)

  const [exportBusy, setExportBusy] = useState(false)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [exportResult, setExportResult] = useState<string[] | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  const [viewer, setViewer] = useState<HTMLElement | null>(null)
  const [fullscreen, toggleFullscreen] = useFullscreen(viewer)

  // ---------- видео проекта ----------

  /** Видео проекта с узнанными длительностями — по ним решаем, какое видео покрывает время. */
  const videos = useMemo<ProjectVideo[]>(
    () => (project?.videos ?? []).map((v) => (v.duration === undefined && durations.has(v.id) ? { ...v, duration: durations.get(v.id) } : v)),
    [project, durations]
  )
  const playable = useMemo(() => videos.filter((v) => !missing.has(v.path)), [videos, missing])
  const missingIds = useMemo(() => new Set(videos.filter((v) => missing.has(v.path)).map((v) => v.id)), [videos, missing])
  const activeVideo = videos.find((v) => v.id === activeVideoId) ?? videos[0] ?? null
  const activeId = activeVideo?.id ?? ''
  const offset = activeVideo?.offset ?? 0

  const wantPath = activeVideo && !missing.has(activeVideo.path) ? activeVideo.path : null
  // пока выбранное видео грузится, старое считается закрытым: время и рисунки не попадут не туда
  const info = loaded && loaded.id === activeId && loaded.path === wantPath ? loaded.info : null

  const clock = useVideoClock(video)
  const fps = info?.fps ?? activeVideo?.fps ?? 30
  const halfFrame = 0.5 / fps
  /** Текущее время проекта. */
  const ptime = clock.time + offset

  const notify = useCallback((msg: string) => setToast(msg), [])
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 6000)
    return () => window.clearTimeout(t)
  }, [toast])

  const showVideo = useCallback((v: VideoInfo, id: string, path: string) => {
    setLoaded({ id, path, info: v })
    setVfrDismissed(false)
    setPlaybackError(false)
  }, [])

  // загружаем активное видео, когда меняется его путь (переключили вкладку, указали файл, отменили конвертацию)
  useEffect(() => {
    if (!wantPath) return
    const current = loadedRef.current
    if (current?.path === wantPath) {
      // тот же файл у другого видео проекта — переоткрывать не нужно
      if (current.id !== activeId) setLoaded({ ...current, id: activeId })
      return
    }
    let cancelled = false
    const id = activeId
    const path = wantPath
    window.api
      .probeVideo(path)
      .then((v) => {
        if (cancelled) return
        showVideo(v, id, path)
        setDurations((d) => new Map(d).set(id, v.duration))
      })
      .catch((e) => {
        if (cancelled) return
        setMissing((m) => new Set(m).add(path))
        notify(`Не удалось открыть видео: ${errorText(e)}`)
      })
    return () => {
      cancelled = true
    }
  }, [wantPath, activeId, showVideo, notify])

  // плейлист объявлен раньше остановок (им нужен его статус), поэтому «взвод» передаём через ref
  const armStops = useRef<() => void>(() => undefined)

  const switchVideo = useCallback(
    (id: string, local: number | null, play: boolean) => {
      if (id === activeId) {
        if (video && local !== null) {
          video.currentTime = local
          if (play) void video.play()
        }
        return
      }
      if (video && info) positions.current.set(activeId, video.currentTime)
      video?.pause()
      pendingSeek.current = { local: local ?? positions.current.get(id) ?? 0, play }
      setActiveVideoId(id)
      setZoom(NO_ZOOM)
    },
    [activeId, video, info]
  )

  // после undo «добавления видео» активное видео могло исчезнуть из проекта
  useEffect(() => {
    if (project && activeVideoId && !project.videos.some((v) => v.id === activeVideoId)) {
      pendingSeek.current = null
      setActiveVideoId(project.videos[0].id)
    }
  }, [project, activeVideoId])

  // новое <video> загрузилось — выполняем отложенную перемотку
  useEffect(() => {
    if (!video) return
    const apply = (): void => {
      const p = pendingSeek.current
      if (!p) return
      pendingSeek.current = null
      armStops.current()
      video.currentTime = p.local
      if (p.play) void video.play()
    }
    if (video.readyState >= 1) apply()
    else video.addEventListener('loadedmetadata', apply, { once: true })
    return () => video.removeEventListener('loadedmetadata', apply)
  }, [video])

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
  // в полном экране во время воспроизведения панели прячутся, пока не шевельнёшь мышью
  const idle = useIdle(viewer, fullscreen && !clock.paused)

  /** Проект для записи на диск: с длительностями и fps открытых видео. */
  const projectForDisk = useCallback(
    (p: Project): Project => {
      const vs = p.videos.map((v) => {
        const duration = v.duration ?? durations.get(v.id)
        const f = v.id === activeId && info ? info.fps : v.fps
        return { ...v, fps: f, ...(duration ? { duration } : {}) }
      })
      return { ...p, videos: vs, videoPath: vs[0].path, fps: vs[0].fps }
    },
    [durations, activeId, info]
  )

  useEffect(() => {
    window.api.setDirty(dirty)
    const name = projectPath ? fileName(projectPath) : project ? fileName(project.videoPath) : null
    window.api.setTitle(name ? `${dirty ? '• ' : ''}${name} — Hockey Analyzer` : 'Hockey Analyzer')
  }, [dirty, projectPath, project])

  useEffect(() => window.api.onConvertProgress(setConverting), [])
  useEffect(() => window.api.onExportProgress(setExportProgress), [])

  // ---------- черновик для восстановления ----------

  useEffect(() => {
    let cancelled = false
    window.api
      .readRecovery()
      .then((r) => {
        if (cancelled) return
        if (r) setRecovery(r)
        else setRecoveryResolved(true)
      })
      .catch(() => !cancelled && setRecoveryResolved(true))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!recoveryResolved) return
    if (!dirty || !project) return window.api.writeRecovery(null)
    const t = window.setTimeout(
      () => window.api.writeRecovery({ savedAt: Date.now(), projectPath, project: projectForDisk(project) }),
      RECOVERY_DELAY_MS
    )
    return () => window.clearTimeout(t)
  }, [project, dirty, projectPath, recoveryResolved, projectForDisk])

  // ---------- воспроизведение ----------

  const now = useCallback(() => (video?.currentTime ?? 0) + offset, [video, offset])
  const duration = clock.duration || info?.duration || 0

  /** Любая ручная перемотка выключает режим «проиграть все». t — время активного видео. */
  const seek = useCallback(
    (t: number) => {
      if (!video) return
      playlist.stop()
      video.currentTime = t
    },
    [video, playlist]
  )

  const togglePlay = useCallback(() => {
    if (!video) return
    if (stops.hold) return stops.release(true)
    if (video.paused) void video.play()
    else video.pause()
  }, [video, stops])

  const stepFrame = useCallback(
    (delta: number) => {
      if (!video) return
      video.pause()
      seek(stepFrameTime(video.currentTime, fps, delta, duration))
    },
    [video, fps, duration, seek]
  )

  const stepBy = useCallback(
    (sign: 1 | -1) => {
      if (video) seek(stepMsTime(video.currentTime, sign * stepMs, duration))
    },
    [video, stepMs, duration, seek]
  )

  const setRate = useCallback(
    (r: number) => {
      if (video) video.playbackRate = clampRate(r)
    },
    [video]
  )

  // ---------- видео и проект ----------

  const confirmDiscard = useCallback(
    async () => !dirty || window.api.confirm('Несохранённые изменения будут потеряны', 'Продолжить без сохранения?'),
    [dirty]
  )

  const resetView = useCallback(() => {
    playlist.stop()
    setDraft(EMPTY_DRAFT)
    setTagFilter(null)
    setZoom(NO_ZOOM)
    positions.current.clear()
    pendingSeek.current = null
  }, [playlist])

  const startNewProject = useCallback(
    (v: VideoInfo) => {
      resetView()
      const pv: ProjectVideo = { id: newId('v'), path: v.path, label: 'Видео 1', offset: 0, fps: v.fps, duration: v.duration }
      dispatch({ type: 'new', video: pv })
      setActiveVideoId(pv.id)
      setMissing(new Set())
      setDurations(new Map([[pv.id, v.duration]]))
      showVideo(v, pv.id, pv.path)
    },
    [resetView, showVideo]
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

  const loadProject = useCallback(
    (p: Project, path: string | null, missingVideos: string[], restored: boolean) => {
      resetView()
      dispatch({ type: 'load', project: p, path, restored })
      setLoaded(null)
      setDurations(new Map())
      setMissing(new Set(p.videos.filter((v) => missingVideos.includes(v.id)).map((v) => v.path)))
      setActiveVideoId(p.videos[0].id)
    },
    [resetView]
  )

  const openProject = useCallback(async () => {
    try {
      if (!(await confirmDiscard())) return
      const opened = await window.api.openProjectDialog()
      if (opened) loadProject(opened.project, opened.path, opened.missingVideos, false)
    } catch (e) {
      notify(`Не удалось открыть проект: ${errorText(e)}`)
    }
  }, [confirmDiscard, loadProject, notify])

  const restoreRecovery = useCallback(async () => {
    if (!recovery || !(await confirmDiscard())) return
    loadProject(recovery.project, recovery.projectPath, recovery.missingVideos, true)
    setRecovery(null)
    setRecoveryResolved(true)
    notify('Работа восстановлена — сохраните проект (Ctrl+S)')
  }, [recovery, confirmDiscard, loadProject, notify])

  const discardRecovery = useCallback(() => {
    window.api.writeRecovery(null)
    setRecovery(null)
    setRecoveryResolved(true)
  }, [])

  /** Указать файл для видео, которое не нашлось, — моменты и рисунки сохраняются. */
  const relocateVideo = useCallback(
    async (id: string) => {
      try {
        const v = await window.api.openVideoDialog()
        if (!v) return
        playlist.stop()
        dispatch({ type: 'updateVideo', id, patch: { path: v.path, fps: v.fps, duration: v.duration } })
        setDurations((d) => new Map(d).set(id, v.duration))
        showVideo(v, id, v.path)
      } catch (e) {
        notify(errorText(e))
      }
    },
    [playlist, showVideo, notify]
  )

  const addVideo = useCallback(
    async (kind: 'next' | 'angle') => {
      if (!project) return
      try {
        const v = await window.api.addVideoDialog()
        if (!v) return
        const pv: ProjectVideo = {
          id: newId('v'),
          path: v.path,
          label: kind === 'next' ? nextPeriodLabel(videos) : angleLabel(videos),
          offset: kind === 'next' ? continuationOffset(videos) : 0,
          fps: v.fps,
          duration: v.duration
        }
        playlist.stop()
        dispatch({ type: 'addVideo', video: pv })
        setDurations((d) => new Map(d).set(pv.id, v.duration))
        if (video && info) positions.current.set(activeId, video.currentTime)
        pendingSeek.current = null
        setActiveVideoId(pv.id)
        setZoom(NO_ZOOM)
        showVideo(v, pv.id, pv.path)
        notify(
          kind === 'next'
            ? `«${pv.label}» начинается с ${formatTime(pv.offset, false)} времени проекта`
            : `«${pv.label}» добавлена. Синхронизируйте её с основным видео: ⚙ рядом с вкладками`
        )
      } catch (e) {
        notify(errorText(e))
      }
    },
    [project, videos, playlist, video, info, activeId, showVideo, notify]
  )

  const selectVideo = useCallback(
    (id: string) => {
      const target = videos.find((v) => v.id === id)
      if (!target || id === activeId) return
      playlist.stop()
      // другой ракурс того же эпизода — открываем на том же времени проекта
      const t = now()
      switchVideo(id, videoCovers(target, t) && video ? Math.max(0, t - target.offset) : null, false)
    },
    [videos, activeId, playlist, now, switchVideo, video]
  )

  const removeVideo = useCallback(
    async (id: string) => {
      const v = videos.find((x) => x.id === id)
      if (!v || videos.length < 2) return
      if (!(await window.api.confirm(`Убрать «${v.label}» из проекта?`, 'Рисунки на этом видео будут удалены. Моменты останутся.'))) return
      playlist.stop()
      if (id === activeId) {
        pendingSeek.current = null
        setActiveVideoId(videos.find((x) => x.id !== id)!.id)
      }
      dispatch({ type: 'removeVideo', id })
    },
    [videos, activeId, playlist]
  )

  const syncVideos = useCallback(
    (targetId: string, refId: string) => {
      const ref = videos.find((v) => v.id === refId)
      const target = videos.find((v) => v.id === targetId)
      if (!ref || !target) return
      const pos = (id: string): number => (id === activeId && video ? video.currentTime : (positions.current.get(id) ?? 0))
      const next = syncOffset(ref, pos(refId), pos(targetId))
      dispatch({ type: 'updateVideo', id: targetId, patch: { offset: next } })
      notify(`«${target.label}» синхронизирована: сдвиг ${next.toFixed(2)} с`)
    },
    [videos, activeId, video, notify]
  )

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
    [project, projectPath, projectForDisk, notify]
  )

  const convertVideo = useCallback(async () => {
    if (!info || !activeVideo) return
    const id = activeVideo.id
    playlist.stop()
    video?.pause()
    setConverting({ ratio: 0, outTime: 0 })
    try {
      const v = await window.api.convertVideo(info.path)
      dispatch({ type: 'updateVideo', id, patch: { path: v.path, fps: v.fps } })
      showVideo(v, id, v.path)
      notify(`Готово: ${fileName(v.path)}. Сохраните проект, чтобы он ссылался на новый файл.`)
    } catch (e) {
      notify(errorText(e))
    } finally {
      setConverting(null)
    }
  }, [info, activeVideo, video, playlist, showVideo, notify])

  // ---------- история ----------

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

  // ---------- моменты ----------

  const changeDraft = useCallback((patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch })), [])
  const markIn = useCallback(() => setDraft((d) => ({ ...d, start: now() })), [now])
  const markOut = useCallback(() => setDraft((d) => ({ ...d, end: now() })), [now])

  const addMoment = useCallback(() => {
    if (draft.start === null || draft.end === null || draft.start === draft.end) return
    const tags = parseTags(draft.tags)
    dispatch({
      type: 'addMoment',
      moment: {
        id: newId('m'),
        title: draft.title.trim() || `Момент ${moments.length + 1}`,
        start: Math.min(draft.start, draft.end),
        end: Math.max(draft.start, draft.end),
        ...(tags.length ? { tags } : {})
      }
    })
    // теги оставляем — обычно подряд размечают однотипные эпизоды
    setDraft((d) => ({ ...EMPTY_DRAFT, tags: d.tags }))
    // возвращаем фокус горячим клавишам, чтобы сразу размечать следующий момент
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }, [draft, moments.length])

  const quickTag = useCallback(
    (q: QuickTag) => {
      if (!info || !activeVideo) return
      const t = now()
      const lo = activeVideo.offset
      const hi = activeVideo.offset + (duration || Infinity)
      const start = Math.max(lo, t - q.before)
      const end = Math.min(hi, t + q.after)
      if (end - start < 0.05) return
      const n = moments.filter((m) => m.tags?.includes(q.tag)).length + 1
      const title = `${q.label} ${n}`
      dispatch({ type: 'addMoment', moment: { id: newId('m'), title, start, end, tags: [q.tag] } })
      notify(`Добавлен «${title}» · ${formatTime(start, false)}–${formatTime(end, false)} (Ctrl+Z — отменить)`)
    },
    [info, activeVideo, now, duration, moments, notify]
  )

  const selectMoment = useCallback(
    (m: Moment) => {
      const src = locateMoment(playable, m, activeId)
      if (!src) return notify('Этот момент не попадает ни в одно открытое видео')
      playlist.stop()
      switchVideo(src.id, Math.max(0, m.start - src.offset), false)
    },
    [playable, activeId, playlist, switchVideo, notify]
  )
  const playOne = useCallback((m: Moment) => playlist.start([m]), [playlist])
  const updateMoment = useCallback((id: string, patch: MomentPatch) => dispatch({ type: 'updateMoment', id, patch }), [])
  const setBoundToNow = useCallback(
    (id: string, bound: 'start' | 'end') => {
      if (info) dispatch({ type: 'updateMoment', id, patch: { [bound]: now() } })
    },
    [info, now]
  )
  const deleteMoment = useCallback(async (m: Moment) => {
    if (await window.api.confirm(`Удалить момент «${m.title}»?`)) dispatch({ type: 'deleteMoment', id: m.id })
  }, [])
  // freeze стабилен, а весь stops меняется на каждой остановке — иначе панель моментов перерисовывалась бы
  const { freeze } = stops
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

  const allTags = useMemo(() => collectTags(moments), [moments])
  const visibleMoments = useMemo(
    () => (tagFilter ? moments.filter((m) => m.tags?.includes(tagFilter)) : moments),
    [moments, tagFilter]
  )
  // тег исчез (моменты удалили или переименовали теги) — иначе фильтр нельзя было бы снять
  useEffect(() => {
    if (tagFilter && !allTags.includes(tagFilter)) setTagFilter(null)
  }, [tagFilter, allTags])
  const playAll = useCallback(() => playlist.start(visibleMoments), [playlist, visibleMoments])

  /** Моменты в координатах активного видео — для таймлайна. */
  const timelineMoments = useMemo(
    () =>
      moments
        .filter((m) => m.end - offset >= 0 && (!duration || m.start - offset <= duration))
        .map((m) => ({
          ...m,
          start: m.start - offset,
          end: m.end - offset,
          drawings: project
            ? (m.drawings ?? []).filter((d) => drawingVideoId(project, d) === activeId).map((d) => ({ ...d, time: d.time - offset }))
            : []
        })),
    [moments, offset, duration, project, activeId]
  )
  const timelineDraft = useMemo(
    () => ({ start: draft.start === null ? null : draft.start - offset, end: draft.end === null ? null : draft.end - offset }),
    [draft.start, draft.end, offset]
  )
  const selectTimelineMoment = useCallback(
    (m: Moment) => {
      const original = moments.find((x) => x.id === m.id)
      if (original) selectMoment(original)
    },
    [moments, selectMoment]
  )

  // ---------- рисование ----------

  const activeMoment = momentAt(moments, ptime, halfFrame)
  const canDraw = !!info && clock.paused && !!activeMoment && !converting
  // рисунок хранится на середине кадра, поэтому «тот же кадр» = расстояние не больше полукадра
  const frame = frameIndex(clock.time, fps)
  const frameTime = (frame + 0.5) / fps + offset
  const visibleShapes = useMemo(
    () =>
      project
        ? moments.flatMap((m) =>
            (m.drawings ?? [])
              .filter((d) => drawingVideoId(project, d) === activeId && Math.abs(d.time - frameTime) <= halfFrame)
              .flatMap((d) => d.shapes)
          )
        : [],
    [project, moments, activeId, frameTime, halfFrame]
  )
  const frameShapeCount =
    project && activeMoment
      ? (activeMoment.drawings?.[findDrawingIndex(project, activeMoment, frameTime, halfFrame, activeId)]?.shapes.length ?? 0)
      : 0

  const addShape = useCallback(
    (shape: Shape) => {
      // за время рисования видео могли запустить — тогда фигура не к этому кадру
      if (!activeMoment || !video?.paused) return
      dispatch({ type: 'addShape', momentId: activeMoment.id, time: frameTime, videoId: activeId, shape, tolerance: halfFrame })
      // в «недавние» попадают цвета, которыми действительно рисовали, а не все промежуточные из пипетки
      updateSettings({ recentColors: pushRecentColor(settings.recentColors, shape.color) })
    },
    [activeMoment, video, frameTime, activeId, halfFrame, settings.recentColors, updateSettings]
  )
  const pickColor = useCallback((c: string) => updateSettings({ color: c }), [updateSettings])

  const undoShape = useCallback(() => {
    if (activeMoment) dispatch({ type: 'undoShape', momentId: activeMoment.id, time: frameTime, videoId: activeId, tolerance: halfFrame })
  }, [activeMoment, frameTime, activeId, halfFrame])
  const clearShapes = useCallback(() => {
    if (activeMoment) dispatch({ type: 'clearShapes', momentId: activeMoment.id, time: frameTime, videoId: activeId, tolerance: halfFrame })
  }, [activeMoment, frameTime, activeId, halfFrame])

  let hint: string | null = null
  if (tool !== 'none' && info) {
    if (!clock.paused) hint = 'Поставьте видео на паузу, чтобы рисовать'
    else if (!activeMoment) hint = 'Рисунок привязывается к моменту — перейдите внутрь момента или создайте его (I / O)'
  }

  // ---------- экспорт и статистика ----------

  const exportCounts = useMemo(
    () => ({ current: activeMoment ? 1 : 0, visible: visibleMoments.length, all: moments.length }),
    [activeMoment, visibleMoments, moments]
  )

  const runExport = useCallback(
    async (scope: ExportScope, options: ExportOptions) => {
      if (!project) return
      const list = scope === 'current' ? (activeMoment ? [activeMoment] : []) : scope === 'visible' ? visibleMoments : moments
      setExportBusy(true)
      setExportProgress(null)
      setExportResult(null)
      setExportError(null)
      try {
        const name =
          scope === 'current' && activeMoment
            ? activeMoment.title
            : `${baseName(projectPath ?? project.videoPath)} — ${scope === 'visible' ? `#${tagFilter}` : 'подборка'}`
        const { request, skipped } = await buildExportRequest(
          project,
          list,
          options,
          async (v) => {
            const meta = v.id === activeId && info ? info : await window.api.probeVideo(v.path)
            return { width: meta.width, height: meta.height, fps: meta.fps }
          },
          activeId,
          name,
          playable
        )
        const result = await window.api.exportClips(request)
        if (result) {
          setExportResult(result.paths)
          if (skipped) setExportError(`Пропущено моментов вне открытых видео: ${skipped}`)
        }
      } catch (e) {
        setExportError(errorText(e))
      } finally {
        setExportBusy(false)
        setExportProgress(null)
      }
    },
    [project, activeMoment, visibleMoments, moments, projectPath, tagFilter, activeId, info, playable]
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

  // ---------- горячие клавиши ----------

  useHotkeys((e) => {
    const mod = e.ctrlKey || e.metaKey
    if (dialog) {
      // на схеме площадки работает общая история правок
      if (dialog.kind === 'board' && mod && (e.code === 'KeyZ' || e.code === 'KeyY')) return e.shiftKey || e.code === 'KeyY' ? redo() : undo()
      // остальные клавиши не должны управлять видео под окном
      return false
    }
    // остановка «до нажатия клавиши»: клавиши со своим действием (Ctrl+S, стрелки, инструменты…)
    // выполняют его, остальные (кроме одиночных модификаторов) продолжают просмотр
    if (stops.hold?.mode === 'key' && !mod && !isPlayerHotkey(e.code) && !['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
      return stops.release(true)
    }
    if (mod) {
      if (e.code === 'KeyS') return void saveProject(e.shiftKey)
      if (e.code === 'KeyO') return void openProject()
      if (e.code === 'KeyZ') return e.shiftKey ? redo() : undo()
      if (e.code === 'KeyY') return redo()
      return false
    }
    if (e.altKey) return false
    if (!info) return false
    if (e.shiftKey && DIGITS.includes(e.code)) {
      const q = settings.quickTags[DIGITS.indexOf(e.code)]
      return q ? quickTag(q) : false
    }
    switch (e.code) {
      case 'Space':
        return togglePlay()
      case 'ArrowLeft':
      case 'ArrowRight': {
        const dir = e.code === 'ArrowLeft' ? -1 : 1
        return e.shiftKey ? stepBy(dir) : stepFrame(dir)
      }
      case 'KeyI':
        return markIn()
      case 'KeyO':
        return markOut()
      case 'Enter':
      case 'NumpadEnter':
        return addMoment()
      case 'Escape':
        // в полном экране Esc обрабатывает сам браузер (выход), здесь — выключаем рисование
        setDrawMenuOpen(false)
        return setTool('none')
      case 'KeyF':
        return toggleFullscreen()
      case 'Digit0':
        return setZoom(NO_ZOOM)
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
      case 'Digit4':
        return setRate(SPEED_PRESETS[Number(e.code.slice(-1)) - 1])
    }
    if (TOOL_KEYS[e.code]) return setTool(TOOL_KEYS[e.code])
    return false
  })

  // ---------- разметка ----------

  // всплывающие окна рендерим внутрь полноэкранного элемента, иначе их не видно
  const overlayRoot = fullscreen && viewer ? viewer : document.body
  const missingActive = activeVideo && missing.has(activeVideo.path) ? activeVideo : null
  const playingMoment = playlist.view ? moments.find((m) => m.id === playlist.view!.ids[playlist.view!.index]) : null

  const banner = (() => {
    if (recovery) {
      const name = recovery.projectPath ? fileName(recovery.projectPath) : fileName(recovery.project.videoPath)
      return (
        <div className="banner banner-warn" role="alert">
          <span>
            Найдена несохранённая работа: {name}, {new Date(recovery.savedAt).toLocaleString('ru')} · моментов:{' '}
            {recovery.project.moments.length}
          </span>
          <Btn variant="primary" onClick={restoreRecovery}>
            Восстановить
          </Btn>
          <Btn onClick={discardRecovery}>Удалить</Btn>
        </div>
      )
    }
    if (converting) {
      return (
        <div className="banner">
          <span>Конвертация в H.264… {Math.round(converting.ratio * 100)}%</span>
          <div className="progress">
            <div style={{ width: `${converting.ratio * 100}%` }} />
          </div>
          <Btn onClick={() => window.api.cancelConvert()}>Отмена</Btn>
        </div>
      )
    }
    if (missingActive) {
      return (
        <div className="banner banner-warn">
          <span>
            Видео «{missingActive.label}» не найдено: {missingActive.path}
          </span>
          <Btn variant="primary" onClick={() => relocateVideo(missingActive.id)}>
            Указать видео
          </Btn>
        </div>
      )
    }
    if (info && (info.needsConversion || playbackError)) {
      return (
        <div className="banner banner-warn">
          <span>
            {info.needsConversion ? `Не воспроизвести: ${info.conversionReason}.` : 'Встроенный плеер не смог воспроизвести файл.'}{' '}
            Конвертировать в H.264 (рядом с исходником)?
          </span>
          <Btn variant="primary" onClick={convertVideo}>
            Конвертировать
          </Btn>
        </div>
      )
    }
    if (info?.variableFrameRate && !vfrDismissed) {
      return (
        <div className="banner banner-warn">
          <span>
            Переменная частота кадров (типично для телефонов): покадровый шаг может пропускать кадры. Конвертировать в
            постоянные {Math.round(info.fps)} fps?
          </span>
          <Btn variant="primary" onClick={convertVideo}>
            Конвертировать
          </Btn>
          <Btn onClick={() => setVfrDismissed(true)}>Скрыть</Btn>
        </div>
      )
    }
    return null
  })()

  const boardMoment = dialog?.kind === 'board' ? moments.find((m) => m.id === dialog.momentId) : undefined

  const dialogs = (() => {
    if (!dialog) return null
    const close = (): void => setDialog(null)
    switch (dialog.kind) {
      case 'settings':
        return (
          <SettingsDialog
            settings={settings}
            settingsFile={settingsFile}
            info={info}
            canOptimize={!!info && !info.needsConversion && !converting}
            onChange={updateSettings}
            onOptimize={() => {
              close()
              void convertVideo()
            }}
            onClose={close}
          />
        )
      case 'stats':
        return (
          <StatsDialog
            moments={moments}
            videos={videos}
            periods={project?.periods ?? []}
            now={ptime}
            onPeriodsChange={(periods) => dispatch({ type: 'setPeriods', periods })}
            onSaveCsv={saveCsv}
            onClose={close}
          />
        )
      case 'export':
        return (
          <ExportDialog
            counts={exportCounts}
            currentTitle={activeMoment?.title ?? null}
            tagFilter={tagFilter}
            hasBoards={moments.some((m) => !!m.board?.length)}
            defaultHold={settings.holdSeconds}
            busy={exportBusy}
            progress={exportProgress}
            result={exportResult}
            error={exportError}
            onExport={runExport}
            onCancel={() => void window.api.cancelExport()}
            onReveal={(p) => void window.api.revealFile(p)}
            onClose={() => {
              close()
              setExportResult(null)
              setExportError(null)
            }}
          />
        )
      case 'videos': {
        const snapshot = new Map(positions.current)
        if (video) snapshot.set(activeId, clock.time)
        return (
          <VideosDialog
            videos={videos}
            activeId={activeId}
            positions={snapshot}
            onUpdate={(id, patch) => dispatch({ type: 'updateVideo', id, patch })}
            onSync={syncVideos}
            onRemove={removeVideo}
            onClose={close}
          />
        )
      }
      case 'board':
        return boardMoment ? (
          <BoardDialog
            moment={boardMoment}
            color={color}
            recentColors={settings.recentColors}
            onColor={pickColor}
            onChange={(shapes) => dispatch({ type: 'setBoard', momentId: boardMoment.id, shapes })}
            onClose={close}
          />
        ) : null
    }
  })()

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <span className="brand-mark">🏒</span>
          <span>Hockey Analyzer</span>
        </div>
        <div className="toolbar-file">
          {project && (
            <>
              <span className="file-name" title={project.videoPath}>
                {fileName(projectPath ?? project.videoPath)}
              </span>
              {dirty && <span className="dirty" title="Есть несохранённые изменения" />}
              <Btn
                variant="ghost"
                className="icon-btn"
                disabled={!state.past.length}
                onClick={undo}
                title={`Отменить${undoLabel(state) ? `: ${undoLabel(state)}` : ''} (Ctrl+Z)`}
                aria-label="Отменить"
              >
                ↶
              </Btn>
              <Btn
                variant="ghost"
                className="icon-btn"
                disabled={!state.future.length}
                onClick={redo}
                title={`Повторить${redoLabel(state) ? `: ${redoLabel(state)}` : ''} (Ctrl+Shift+Z)`}
                aria-label="Повторить"
              >
                ↷
              </Btn>
            </>
          )}
        </div>
        <div className="toolbar-actions">
          <Btn variant="ghost" onClick={openVideo} title="Открыть видео матча">
            Открыть видео
          </Btn>
          <Btn variant="ghost" onClick={openProject} title="Открыть проект (Ctrl+O)">
            Открыть проект
          </Btn>
          <Btn variant="ghost" onClick={() => setDialog({ kind: 'stats' })} disabled={!project} title="Статистика по тегам и периодам, выгрузка в CSV">
            Статистика
          </Btn>
          <Btn
            variant="ghost"
            onClick={() => {
              video?.pause()
              setDialog({ kind: 'export' })
            }}
            disabled={!project || !moments.length}
            title="Сохранить моменты в mp4 с рисунками"
          >
            Экспорт
          </Btn>
          <Btn variant="ghost" onClick={() => saveProject(true)} disabled={!project} title="Сохранить как (Ctrl+Shift+S)">
            Сохранить как…
          </Btn>
          <Btn variant="primary" onClick={() => saveProject(false)} disabled={!project} title="Сохранить (Ctrl+S)">
            Сохранить
          </Btn>
          <Btn variant="ghost" className="icon-btn" onClick={openSettings} title="Настройки" aria-label="Настройки">
            ⚙
          </Btn>
        </div>
      </header>

      <main className="workspace">
        <section ref={setViewer} className={`viewer${fullscreen ? ' is-fullscreen' : ''}${idle ? ' is-idle' : ''}`}>
          {project && (
            <VideoBar
              videos={videos}
              activeId={activeId}
              missing={missingIds}
              disabled={!!converting}
              onSelect={selectVideo}
              onAdd={(kind) => void addVideo(kind)}
              onManage={() => setDialog({ kind: 'videos' })}
            />
          )}
          <VideoStage
            info={info}
            videoRef={setVideo}
            shapes={visibleShapes}
            canDraw={canDraw}
            tool={tool}
            color={color}
            onAddShape={addShape}
            onDrawStart={freeze}
            onDropFile={dropVideo}
            onVideoError={() => setPlaybackError(true)}
            onClickVideo={togglePlay}
            hint={stops.hold ? null : hint}
            overlay={banner}
            zoom={zoom}
            onZoom={setZoom}
            floating={
              <>
                <DrawMenu
                  open={drawMenuOpen}
                  tool={tool}
                  color={color}
                  recentColors={settings.recentColors}
                  shapeCount={frameShapeCount}
                  canEdit={canDraw}
                  onOpenChange={(open) => {
                    setDrawMenuOpen(open)
                    if (open) freeze()
                  }}
                  onTool={setTool}
                  onColor={pickColor}
                  onUndo={undoShape}
                  onClear={clearShapes}
                />
                {playingMoment && (
                  <div className="moment-caption" aria-live="polite">
                    <strong>{playingMoment.title}</strong>
                    {playingMoment.notes && <span>{playingMoment.notes}</span>}
                  </div>
                )}
                {stops.hold && <HoldOverlay hold={stops.hold} onContinue={() => stops.release(true)} />}
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
                  <Btn variant="primary" onClick={openVideo}>
                    Открыть видео
                  </Btn>
                  <Btn onClick={openProject}>Открыть проект</Btn>
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
          holding={!!stops.hold}
          disabled={!info}
          onDraftChange={changeDraft}
          onMarkIn={markIn}
          onMarkOut={markOut}
          onAdd={addMoment}
          onTagFilter={setTagFilter}
          onPlayAll={playAll}
          onStopPlaylist={playlist.stop}
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

      {dialogs && createPortal(dialogs, overlayRoot)}

      {toast &&
        createPortal(
          <div className="toast" role="status" onClick={() => setToast(null)}>
            {toast}
          </div>,
          overlayRoot
        )}
    </div>
  )
}
