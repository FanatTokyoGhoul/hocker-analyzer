import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { request } from 'http'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { RemoteState } from '../shared/remote'
import { FFMPEG } from './ffmpeg'
import { publishRemote, qrSvg, remoteEndpoint, startRemote, stopRemote, tokenMatches } from './remote'

const state = { ready: true, title: 'match', frameKey: 'v1:3', moments: [] } as unknown as RemoteState

let dir = ''
let clip = ''
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'remote-test-'))
  clip = join(dir, 'clip.mp4')
  execFileSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=1', '-pix_fmt', 'yuv420p', clip])
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** Сервер на всех интерфейсах; ходим через 127.0.0.1 — он есть и там, где нет сети. */
async function start(allowed: (p: string) => boolean = () => false) {
  const onCommand = vi.fn()
  const onStatus = vi.fn()
  const info = await startRemote({ onCommand, onStatus, isAllowedMedia: allowed })
  const { port, token } = remoteEndpoint()!
  return { info, port, token, base: `http://127.0.0.1:${port}`, onCommand, onStatus }
}

/** Запрос с заданными Host и адресом отправителя (fetch не позволяет их менять). */
function raw(port: number, path: string, opts: { host?: string; localAddress?: string } = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, localAddress: opts.localAddress, headers: { Host: opts.host ?? `127.0.0.1:${port}` } },
      (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      }
    )
    req.on('error', reject)
    req.end()
  })
}

const post = (base: string, token: string, body: string, contentType = 'application/json') =>
  fetch(`${base}/api/command`, { method: 'POST', headers: { 'X-Remote-Token': token, 'Content-Type': contentType }, body })

describe('сервер пульта', () => {
  afterEach(() => stopRemote())

  it('токен сравнивается целиком и по байтам', () => {
    expect(tokenMatches('abc', 'abc')).toBe(true)
    expect(tokenMatches('abc', 'abd')).toBe(false)
    expect(tokenMatches('abc', 'ab')).toBe(false)
    expect(tokenMatches('abc', undefined)).toBe(false)
    // та же длина в символах, но не в байтах — не падаем, а отказываем
    expect(tokenMatches('abc', 'éaa')).toBe(false)
    expect(tokenMatches('', '')).toBe(false)
  })

  it('QR-код — svg', () => {
    expect(qrSvg('http://192.168.1.2:1234/?t=x')).toMatch(/^<svg/)
  })

  it('страница и API только с токеном; команды проверяются', async () => {
    const { info, token, base, onCommand } = await start()
    expect(info.running).toBe(true)
    expect((await fetch(`${base}/?t=wrong`)).status).toBe(401)
    const page = await fetch(`${base}/?t=${token}`)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(await page.text()).toContain('<html')

    expect((await post(base, 'nope', '{"type":"togglePlay"}')).status).toBe(401)
    expect((await post(base, token, '{"type":"rm -rf"}')).status).toBe(400)
    expect((await post(base, token, 'not json')).status).toBe(400)
    expect((await post(base, token, 'x'.repeat(300 * 1024))).status).toBe(413)
    expect((await post(base, token, '{"type":"stepFrame","delta":1}')).status).toBe(204)
    expect(onCommand).toHaveBeenCalledWith({ type: 'stepFrame', delta: 1 })
    expect(onCommand).toHaveBeenCalledTimes(1)
    expect((await fetch(`${base}/api/ping`, { headers: { 'X-Remote-Token': token } })).status).toBe(204)
    expect((await fetch(`${base}/api/unknown?t=${token}`)).status).toBe(404)
  })

  it('кадр — только из разрешённого видео; ключ кадра в заголовке', async () => {
    const { token, base } = await start((p) => p === clip)
    publishRemote({ state, frame: { videoPath: '/etc/passwd', time: 0 } })
    expect((await fetch(`${base}/api/frame?t=${token}`)).status).toBe(409)
    publishRemote({ state, frame: { videoPath: clip, time: 0.1 } })
    // одновременные запросы одного кадра ждут один снимок
    const [a, b] = await Promise.all([1, 2].map(() => fetch(`${base}/api/frame`, { headers: { 'X-Remote-Token': token } })))
    expect(a.status).toBe(200)
    expect(a.headers.get('content-type')).toBe('image/jpeg')
    expect(a.headers.get('x-frame-key')).toBe('v1%3A3')
    expect((await a.arrayBuffer()).byteLength).toBe((await b.arrayBuffer()).byteLength)
    // мусор от рендерера не принимается
    publishRemote({ state, frame: { videoPath: clip, time: Number.NaN } })
    expect((await fetch(`${base}/api/frame?t=${token}`)).status).toBe(409)
  })

  it('состояние приходит по SSE', async () => {
    const { token, base } = await start()
    publishRemote({ state, frame: null })
    const res = await fetch(`${base}/api/events?t=${token}`)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let text = ''
    while (!text.includes('data:')) text += decoder.decode((await reader.read()).value, { stream: true })
    expect(text).toContain('"title":"match"')
    await reader.cancel()
  })

  it('чужой Host (DNS rebinding) отклоняется даже с верным токеном', async () => {
    const { port, token } = await start()
    expect(await raw(port, `/?t=${token}`, { host: `evil.example:${port}` })).toBe(421)
  })

  it('привязка к первому устройству, только JSON, ограничение частоты', async () => {
    const { port, token, base, onCommand, onStatus } = await start()
    expect(await raw(port, `/?t=${token}`, { localAddress: '127.0.0.1' })).toBe(200)
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ device: '127.0.0.1' }))
    // другое устройство с той же ссылкой не пускаем
    expect(await raw(port, `/?t=${token}`, { localAddress: '127.0.0.2' })).toBe(403)

    // «простой» запрос, который браузер шлёт без preflight, не принимаем
    expect((await post(base, token, '{"type":"togglePlay"}', 'text/plain')).status).toBe(415)
    // токен в адресе для команд не годится — только заголовок
    const viaQuery = await fetch(`${base}/api/command?t=${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"type":"togglePlay"}' })
    expect(viaQuery.status).toBe(401)
    const statuses: number[] = []
    for (let i = 0; i < 40; i++) statuses.push((await post(base, token, '{"type":"togglePlay"}')).status)
    expect(statuses).toContain(429)
    expect(onCommand.mock.calls.length).toBeLessThanOrEqual(31)
  })

  it('после выключения старый токен не работает, при включении — новый', async () => {
    const first = await start()
    stopRemote()
    expect(remoteEndpoint()).toBeNull()
    const second = await start()
    expect(second.token).not.toBe(first.token)
    expect((await fetch(`${second.base}/?t=${first.token}`)).status).toBe(401)
  })
})
