import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from 'react'
import type { ConvertProgress, Project, ProjectVideo, VideoInfo } from '../../../shared/types'
import { newId } from '../lib/ids'
import { errorText } from '../lib/errors'
import { fileName } from '../lib/paths'
import type { ProjectAction } from '../lib/projectState'
import { formatTime } from '../lib/time'
import { angleLabel, continuationOffset, nextPeriodLabel, syncOffset, videoCovers } from '../lib/videos'

type Options = {
  project: Project | null
  dispatch: Dispatch<ProjectAction>
  video: HTMLVideoElement | null
  notify(msg: string): void
  /** Ручная работа с видео выключает «проиграть все». */
  stopPlaylist(): void
  /** Перед отложенной перемоткой только что загруженного видео (взвод остановок на рисунках). */
  beforeSeek(): void
  /** Видео сменилось (сбросить зум и т.п.). */
  onSwitch(): void
}

/**
 * Видео проекта: какое открыто, какие не нашлись, переключение с отложенной перемоткой,
 * добавление периодов и ракурсов, синхронизация, конвертация. Время моментов — время проекта,
 * время <video> — локальное: local = project − offset активного видео.
 */
export function useVideoSources({ project, dispatch, video, notify, stopPlaylist, beforeSeek, onSwitch }: Options) {
  // колбэки из App меняются на каждом рендере — держим последние в ref
  const cb = useRef({ notify, stopPlaylist, beforeSeek, onSwitch })
  cb.current = { notify, stopPlaylist, beforeSeek, onSwitch }

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

  const [converting, setConverting] = useState<ConvertProgress | null>(null)
  const [playbackError, setPlaybackError] = useState(false)
  const [vfrDismissed, setVfrDismissed] = useState(false)

  /** Видео проекта с узнанными длительностями — по ним решаем, какое видео покрывает время. */
  const videos = useMemo<ProjectVideo[]>(
    () => (project?.videos ?? []).map((v) => (v.duration === undefined && durations.has(v.id) ? { ...v, duration: durations.get(v.id) } : v)),
    [project, durations]
  )
  const playable = useMemo(() => videos.filter((v) => !missing.has(v.path)), [videos, missing])
  const missingIds = useMemo(() => new Set(videos.filter((v) => missing.has(v.path)).map((v) => v.id)), [videos, missing])
  const activeVideo = videos.find((v) => v.id === activeVideoId) ?? videos[0] ?? null
  const activeId = activeVideo?.id ?? ''
  const activeRef = useRef(activeId)
  activeRef.current = activeId
  const offset = activeVideo?.offset ?? 0
  const missingActive = activeVideo && missing.has(activeVideo.path) ? activeVideo : null

  const wantPath = activeVideo && !missingActive ? activeVideo.path : null
  // пока выбранное видео грузится, старое считается закрытым: время и рисунки не попадут не туда
  const info = loaded && loaded.id === activeId && loaded.path === wantPath ? loaded.info : null

  useEffect(() => window.api.onConvertProgress(setConverting), [])

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
        cb.current.notify(`Не удалось открыть видео: ${errorText(e)}`)
      })
    return () => {
      cancelled = true
    }
  }, [wantPath, activeId, showVideo])

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
      cb.current.beforeSeek()
      video.currentTime = p.local
      if (p.play) void video.play()
    }
    if (video.readyState >= 1) apply()
    else video.addEventListener('loadedmetadata', apply, { once: true })
    return () => video.removeEventListener('loadedmetadata', apply)
  }, [video])

  /** Сделать видео активным; local — куда перемотать после загрузки (null — где оно стояло). */
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
      cb.current.onSwitch()
    },
    [activeId, video, info]
  )

  const forget = (): void => {
    positions.current.clear()
    pendingSeek.current = null
  }

  /** Новый проект из открытого видео. */
  const startProject = useCallback(
    (v: VideoInfo) => {
      forget()
      const pv: ProjectVideo = { id: newId('v'), path: v.path, label: 'Видео 1', offset: 0, fps: v.fps, duration: v.duration }
      dispatch({ type: 'new', video: pv })
      setActiveVideoId(pv.id)
      setMissing(new Set())
      setDurations(new Map([[pv.id, v.duration]]))
      showVideo(v, pv.id, pv.path)
    },
    [dispatch, showVideo]
  )

  /** Проект из файла или черновика; missingVideos — id видео, которые main не нашёл. */
  const loadProject = useCallback(
    (p: Project, path: string | null, missingVideos: string[], restored: boolean) => {
      forget()
      dispatch({ type: 'load', project: p, path, restored })
      setLoaded(null)
      setDurations(new Map())
      setMissing(new Set(p.videos.filter((v) => missingVideos.includes(v.id)).map((v) => v.path)))
      setActiveVideoId(p.videos[0].id)
    },
    [dispatch]
  )

  /** Указать файл для видео, которое не нашлось, — моменты и рисунки сохраняются. */
  const relocateVideo = useCallback(
    async (id: string) => {
      try {
        const v = await window.api.openVideoDialog()
        if (!v) return
        cb.current.stopPlaylist()
        dispatch({ type: 'updateVideo', id, patch: { path: v.path, fps: v.fps, duration: v.duration } })
        setDurations((d) => new Map(d).set(id, v.duration))
        showVideo(v, id, v.path)
      } catch (e) {
        cb.current.notify(errorText(e))
      }
    },
    [dispatch, showVideo]
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
        cb.current.stopPlaylist()
        dispatch({ type: 'addVideo', video: pv })
        setDurations((d) => new Map(d).set(pv.id, v.duration))
        if (video && info) positions.current.set(activeId, video.currentTime)
        pendingSeek.current = null
        setActiveVideoId(pv.id)
        cb.current.onSwitch()
        showVideo(v, pv.id, pv.path)
        cb.current.notify(
          kind === 'next'
            ? `«${pv.label}» начинается с ${formatTime(pv.offset, false)} времени проекта`
            : `«${pv.label}» добавлена. Синхронизируйте её с основным видео: ⚙ рядом с вкладками`
        )
      } catch (e) {
        cb.current.notify(errorText(e))
      }
    },
    [project, videos, dispatch, video, info, activeId, showVideo]
  )

  /** Вкладка видео: другой ракурс того же эпизода открываем на том же времени проекта. */
  const selectVideo = useCallback(
    (id: string) => {
      const target = videos.find((v) => v.id === id)
      if (!target || id === activeId) return
      cb.current.stopPlaylist()
      const t = (video?.currentTime ?? 0) + offset
      switchVideo(id, videoCovers(target, t) && video ? Math.max(0, t - target.offset) : null, false)
    },
    [videos, activeId, video, offset, switchVideo]
  )

  const removeVideo = useCallback(
    async (id: string) => {
      const v = videos.find((x) => x.id === id)
      if (!v || videos.length < 2) return
      if (!(await window.api.confirm(`Убрать «${v.label}» из проекта?`, 'Рисунки на этом видео будут удалены. Моменты останутся.'))) return
      cb.current.stopPlaylist()
      if (id === activeId) {
        pendingSeek.current = null
        setActiveVideoId(videos.find((x) => x.id !== id)!.id)
      }
      dispatch({ type: 'removeVideo', id })
    },
    [videos, activeId, dispatch]
  )

  /** Где сейчас стоит каждое видео (локальное время): активное — по <video>, остальные — где их оставили. */
  const positionOf = useCallback(
    (id: string): number => (id === activeId && video ? video.currentTime : (positions.current.get(id) ?? 0)),
    [activeId, video]
  )

  const syncVideos = useCallback(
    (targetId: string, refId: string) => {
      const ref = videos.find((v) => v.id === refId)
      const target = videos.find((v) => v.id === targetId)
      if (!ref || !target) return
      const next = syncOffset(ref, positionOf(refId), positionOf(targetId))
      dispatch({ type: 'updateVideo', id: targetId, patch: { offset: next } })
      cb.current.notify(`«${target.label}» синхронизирована: сдвиг ${next.toFixed(2)} с`)
    },
    [videos, positionOf, dispatch]
  )

  const convertVideo = useCallback(async () => {
    if (!info || !activeVideo) return
    const id = activeVideo.id
    cb.current.stopPlaylist()
    video?.pause()
    setConverting({ ratio: 0, outTime: 0 })
    try {
      const v = await window.api.convertVideo(info.path)
      dispatch({ type: 'updateVideo', id, patch: { path: v.path, fps: v.fps } })
      // пока шла конвертация, могли переключиться на другое видео — его не подменяем, это откроется при возврате
      if (activeRef.current === id) showVideo(v, id, v.path)
      cb.current.notify(`Готово: ${fileName(v.path)}. Сохраните проект, чтобы он ссылался на новый файл.`)
    } catch (e) {
      cb.current.notify(errorText(e))
    } finally {
      setConverting(null)
    }
  }, [info, activeVideo, video, dispatch, showVideo])

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

  return {
    videos,
    playable,
    missingIds,
    activeVideo,
    activeId,
    offset,
    info,
    missingActive,
    converting,
    playbackError,
    reportPlaybackError: useCallback(() => setPlaybackError(true), []),
    vfrDismissed,
    dismissVfr: useCallback(() => setVfrDismissed(true), []),
    switchVideo,
    startProject,
    loadProject,
    relocateVideo,
    addVideo,
    selectVideo,
    removeVideo,
    positionOf,
    syncVideos,
    convertVideo,
    projectForDisk
  }
}
