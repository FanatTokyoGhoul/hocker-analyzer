import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RemoteInfo, RemotePublish } from '../../../shared/types'
import type { RemoteCommand } from '../../../shared/remote'
import { errorText } from '../lib/errors'

/** Как часто отдавать состояние телефону; одинаковые снимки main не пересылает. */
const PUBLISH_MS = 120

export type Remote = {
  info: RemoteInfo | null
  busy: boolean
  error: string | null
  start(): void
  stop(): void
  /** Отвязать телефон: перезапуск с новым токеном и QR-кодом. */
  renew(): void
}

/**
 * Пульт с телефона. Пока включён, раз в PUBLISH_MS отдаёт в main снимок состояния (snapshot),
 * а команды телефона передаёт в onCommand — их выполняют те же функции, что и горячие клавиши.
 */
export function useRemote(snapshot: () => RemotePublish, onCommand: (cmd: RemoteCommand) => void): Remote {
  const [info, setInfo] = useState<RemoteInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef({ snapshot, onCommand })
  latest.current = { snapshot, onCommand }

  useEffect(() => window.api.onRemoteCommand((cmd) => latest.current.onCommand(cmd)), [])
  useEffect(() => window.api.onRemoteStatus(setInfo), [])

  const running = !!info?.running
  useEffect(() => {
    if (!running) return
    const publish = (): void => window.api.publishRemoteState(latest.current.snapshot())
    publish()
    const t = window.setInterval(publish, PUBLISH_MS)
    return () => window.clearInterval(t)
  }, [running])

  const start = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      setInfo(await window.api.startRemote())
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const stop = useCallback(async () => {
    setBusy(true)
    try {
      await window.api.stopRemote()
      setInfo(null)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const renew = useCallback(async () => {
    await stop()
    await start()
  }, [start, stop])

  return useMemo(
    () => ({ info, busy, error, start: () => void start(), stop: () => void stop(), renew: () => void renew() }),
    [info, busy, error, start, stop, renew]
  )
}
