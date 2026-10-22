import { useCallback, useEffect, useMemo, useState, type Dispatch } from 'react'
import type { Moment, Project, ProjectVideo } from '../../../shared/types'
import type { QuickTag } from '../../../shared/settings'
import type { Draft, MomentPatch } from '../components/MomentsPanel'
import { newId } from '../lib/ids'
import { collectTags, drawingVideoId, parseTags, type ProjectAction } from '../lib/projectState'
import { formatTime } from '../lib/time'
import { locateMoment } from '../lib/videos'

const EMPTY_DRAFT: Draft = { start: null, end: null, title: '', tags: '' }

type Options = {
  project: Project | null
  dispatch: Dispatch<ProjectAction>
  /** Текущее время проекта. */
  now(): number
  /** Видео открыто. */
  ready: boolean
  activeVideo: ProjectVideo | null
  /** Длительность активного видео. */
  duration: number
  playable: ProjectVideo[]
  quickTags: QuickTag[]
  /** Стабильные функции плейлиста (весь объект меняется на каждом шаге «проиграть все»). */
  stopPlaylist(): void
  startPlaylist(items: Moment[]): void
  switchVideo(id: string, local: number | null, play: boolean): void
  notify(msg: string): void
}

/**
 * Моменты: черновик I/O, добавление (в том числе кнопками быстрой разметки), переход к моменту
 * на нужном видео, фильтр по тегу, моменты в координатах активного видео для таймлайна.
 */
export function useMoments({ project, dispatch, now, ready, activeVideo, duration, playable, quickTags, stopPlaylist, startPlaylist, switchVideo, notify }: Options) {
  const moments = useMemo(() => project?.moments ?? [], [project])
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const activeId = activeVideo?.id ?? ''
  const offset = activeVideo?.offset ?? 0

  /** Новый проект: черновик и фильтр от старого не нужны. */
  const reset = useCallback(() => {
    setDraft(EMPTY_DRAFT)
    setTagFilter(null)
  }, [])

  const changeDraft = useCallback((patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch })), [])
  const markIn = useCallback(() => ready && setDraft((d) => ({ ...d, start: now() })), [ready, now])
  const markOut = useCallback(() => ready && setDraft((d) => ({ ...d, end: now() })), [ready, now])

  /** Добавить момент из начала и конца черновика; title/tags — с телефона, иначе из полей панели. */
  const addMoment = useCallback(
    (fromRemote?: { title: string; tags: string[] }) => {
      if (draft.start === null || draft.end === null || draft.start === draft.end) return
      const tags = fromRemote ? [...new Set(fromRemote.tags.map((t) => t.trim()).filter(Boolean))] : parseTags(draft.tags)
      const title = (fromRemote ? fromRemote.title : draft.title).trim()
      dispatch({
        type: 'addMoment',
        moment: {
          id: newId('m'),
          title: title || `Момент ${moments.length + 1}`,
          start: Math.min(draft.start, draft.end),
          end: Math.max(draft.start, draft.end),
          ...(tags.length ? { tags } : {})
        }
      })
      if (fromRemote) {
        // с телефона — не трогаем то, что на компьютере набирают в полях, и фокус
        setDraft((d) => ({ ...d, start: null, end: null }))
        return
      }
      // теги оставляем — обычно подряд размечают однотипные эпизоды
      setDraft((d) => ({ ...EMPTY_DRAFT, tags: d.tags }))
      // возвращаем фокус горячим клавишам, чтобы сразу размечать следующий момент
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    },
    [draft, moments.length, dispatch]
  )
  /** Для панели и Enter: обработчик клика не должен попасть в fromRemote. */
  const addFromPanel = useCallback(() => addMoment(), [addMoment])

  const quickTag = useCallback(
    (q: QuickTag) => {
      if (!ready || !activeVideo) return
      const t = now()
      const start = Math.max(activeVideo.offset, t - q.before)
      const end = Math.min(activeVideo.offset + (duration || Infinity), t + q.after)
      if (end - start < 0.05) return
      const title = `${q.label} ${moments.filter((m) => m.tags?.includes(q.tag)).length + 1}`
      dispatch({ type: 'addMoment', moment: { id: newId('m'), title, start, end, tags: [q.tag] } })
      notify(`Добавлен «${title}» · ${formatTime(start, false)}–${formatTime(end, false)} (Ctrl+Z — отменить)`)
    },
    [ready, activeVideo, now, duration, moments, dispatch, notify]
  )
  /** Кнопка быстрой разметки по номеру (Shift+цифра, пульт); false — такой кнопки нет. */
  const quickTagAt = useCallback(
    (index: number): boolean => {
      const q = quickTags[index]
      if (q) quickTag(q)
      return !!q
    },
    [quickTags, quickTag]
  )

  const selectMoment = useCallback(
    (m: Moment) => {
      const src = locateMoment(playable, m, activeId)
      if (!src) return notify('Этот момент не попадает ни в одно открытое видео')
      stopPlaylist()
      switchVideo(src.id, Math.max(0, m.start - src.offset), false)
    },
    [playable, activeId, stopPlaylist, switchVideo, notify]
  )
  const playOne = useCallback((m: Moment) => startPlaylist([m]), [startPlaylist])
  const byId = useCallback((id: string) => moments.find((m) => m.id === id), [moments])
  const selectMomentById = useCallback((id: string) => void (byId(id) && selectMoment(byId(id)!)), [byId, selectMoment])
  const playMomentById = useCallback((id: string) => void (byId(id) && playOne(byId(id)!)), [byId, playOne])
  const updateMoment = useCallback((id: string, patch: MomentPatch) => dispatch({ type: 'updateMoment', id, patch }), [dispatch])
  const setBoundToNow = useCallback(
    (id: string, bound: 'start' | 'end') => {
      if (ready) dispatch({ type: 'updateMoment', id, patch: { [bound]: now() } })
    },
    [ready, now, dispatch]
  )
  const deleteMoment = useCallback(
    async (m: Moment) => {
      if (await window.api.confirm(`Удалить момент «${m.title}»?`)) dispatch({ type: 'deleteMoment', id: m.id })
    },
    [dispatch]
  )

  const allTags = useMemo(() => collectTags(moments), [moments])
  const visibleMoments = useMemo(() => (tagFilter ? moments.filter((m) => m.tags?.includes(tagFilter)) : moments), [moments, tagFilter])
  // тег исчез (моменты удалили или переименовали теги) — иначе фильтр нельзя было бы снять
  useEffect(() => {
    if (tagFilter && !allTags.includes(tagFilter)) setTagFilter(null)
  }, [tagFilter, allTags])
  const playAll = useCallback(() => startPlaylist(visibleMoments), [startPlaylist, visibleMoments])

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
  // на таймлайне моменты в локальном времени — переходим по id к оригиналу
  const selectTimelineMoment = useCallback((m: Moment) => selectMomentById(m.id), [selectMomentById])

  return {
    moments,
    draft,
    reset,
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
    updateMoment,
    setBoundToNow,
    deleteMoment,
    allTags,
    tagFilter,
    setTagFilter,
    visibleMoments,
    playAll,
    timelineMoments,
    timelineDraft,
    selectTimelineMoment
  }
}
