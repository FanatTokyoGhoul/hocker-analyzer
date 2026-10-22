import { spawn, type ChildProcess } from 'child_process'
import { randomBytes, timingSafeEqual } from 'crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { networkInterfaces } from 'os'
import { resolve } from 'path'
import qrcode from 'qrcode-generator'
import type { RemoteAddress, RemoteInfo, RemotePublish } from '../shared/types'
import { parseRemoteCommand, type RemoteCommand } from '../shared/remote'
import { FFMPEG } from './ffmpeg'
import { INPUT_WHITELIST } from './probe'
import page from './remote/page.html?raw'

const MAX_BODY = 256 * 1024
const MAX_CLIENTS = 8
const HEARTBEAT_MS = 15000
/** Не чаще — иначе телефон захлебнётся событиями на 60 fps. */
const STATE_INTERVAL_MS = 150
const FRAME_WIDTH = 1280
/** Медленный клиент не должен копить в памяти бесконечный хвост событий. */
const MAX_SSE_BUFFER = 1 << 20
/** Команд в секунду (с запасом на быстрые нажатия) — больше похоже на флуд. */
const COMMANDS_PER_SECOND = 30
/** Никто не подключён столько времени — выключаемся сами, чтобы порт не висел открытым. */
const IDLE_STOP_MS = 30 * 60 * 1000

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy':
    "default-src 'none'; img-src 'self' blob: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store'
}
const API_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }

export type RemoteDeps = {
  onCommand(cmd: RemoteCommand): void
  onStatus(info: RemoteInfo): void
  /** Снимок кадра только из видео, которые пользователь сам открыл. */
  isAllowedMedia(path: string): boolean
}

/** Частная сеть (RFC 1918), link-local или сам компьютер — телефоны приходят только отсюда. */
export function isLocalNetwork(ip: string): boolean {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|127\.)/.test(ip)
}
const isPrivate = (ip: string): boolean => isLocalNetwork(ip) && !ip.startsWith('127.')

/** Адрес клиента без IPv6-обёртки (::ffff:192.168.0.5). */
const clientIp = (req: IncomingMessage): string => (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '')

/** IPv4-адреса компьютера в локальных сетях: сначала частные (Wi-Fi, точка доступа). */
export function lanAddresses(): string[] {
  const all = Object.values(networkInterfaces())
    .flat()
    .filter((a): a is NonNullable<typeof a> => !!a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address)
  return [...new Set(all)].sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)))
}

export function qrSvg(text: string): string {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true })
}

/** Сравнение токена за постоянное время. */
export function tokenMatches(expected: string, given: unknown): boolean {
  if (typeof given !== 'string' || !expected) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

let server: Server | null = null
let token = ''
let deps: RemoteDeps | null = null
let latest: RemotePublish | null = null
let sentJson = ''
let stateTimer: NodeJS.Timeout | null = null
const clients = new Set<ServerResponse>()
/** Снимок кадра: key — видео и время, frameKey — какой кадр это для телефона. */
let frameCache: { key: string; frameKey: string; child: ChildProcess; jpeg: Promise<Buffer> } | null = null
/**
 * Пульт привязывается к первому устройству, открывшему страницу: перехваченная в открытом Wi-Fi
 * ссылка с другого адреса не сработает. «Новый код» снимает привязку.
 */
let pairedIp: string | null = null
let lastActivity = 0
let bucket = { tokens: COMMANDS_PER_SECOND, at: 0 }

function info(): RemoteInfo {
  const port = server?.address()
  if (!server || !port || typeof port === 'string') return { running: false, addresses: [], clients: 0, device: null }
  const addresses: RemoteAddress[] = lanAddresses().map((ip) => {
    const url = `http://${ip}:${port.port}/?t=${token}`
    return { ip, url, qrSvg: qrSvg(url) }
  })
  return { running: true, addresses, clients: clients.size, device: pairedIp }
}

function send(res: ServerResponse, status: number, body = '', headers: Record<string, string> = {}): void {
  res.writeHead(status, { ...API_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...headers })
  res.end(body)
}

class BodyTooLarge extends Error {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        req.pause()
        reject(new BodyTooLarge())
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function pushState(): void {
  if (!latest || clients.size === 0) return
  const json = JSON.stringify(latest.state)
  if (json === sentJson) return
  sentJson = json
  for (const res of clients) {
    // телефон уснул с открытым соединением — не копим ему события, отключаем (переподключится сам)
    if (res.writableLength > MAX_SSE_BUFFER) {
      res.destroy()
      clients.delete(res)
      continue
    }
    res.write(`data: ${json}\n\n`)
  }
}

/** Ограничение частоты команд (token bucket). */
function takeCommandToken(now = Date.now()): boolean {
  bucket.tokens = Math.min(COMMANDS_PER_SECOND, bucket.tokens + ((now - bucket.at) / 1000) * COMMANDS_PER_SECOND)
  bucket.at = now
  if (bucket.tokens < 1) return false
  bucket.tokens -= 1
  return true
}

/** Кадр снимается ffmpeg-ом из файла: canvas с <video> из media:// был бы «испорчен» для чтения. */
function extractFrame(videoPath: string, time: number): { child: ChildProcess; jpeg: Promise<Buffer> } {
  let child!: ChildProcess
  const jpeg = new Promise<Buffer>((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-ss', Math.max(0, time).toFixed(4),
      ...INPUT_WHITELIST,
      '-i', videoPath,
      '-frames:v', '1',
      '-vf', `scale='min(${FRAME_WIDTH},iw)':-2`,
      '-q:v', '5',
      '-f', 'image2pipe',
      '-c:v', 'mjpeg',
      'pipe:1'
    ]
    child = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'ignore'] })
    const chunks: Buffer[] = []
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000)
    child.stdout!.on('data', (c: Buffer) => chunks.push(c))
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0 && chunks.length) resolve(Buffer.concat(chunks))
      else reject(new Error(`ffmpeg ${code}`))
    })
  })
  return { child, jpeg }
}

/**
 * Host должен быть адресом этого компьютера: иначе страница чужого сайта через DNS rebinding
 * могла бы обращаться к серверу как «к себе». Токен всё равно нужен, это второй рубеж.
 */
function hostAllowed(host: string | undefined): boolean {
  const port = server?.address()
  if (!host || !port || typeof port === 'string') return false
  const allowed = new Set([...lanAddresses(), '127.0.0.1', 'localhost'].map((h) => `${h}:${port.port}`))
  return allowed.has(host.toLowerCase())
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!hostAllowed(req.headers.host)) return send(res, 421, 'Misdirected request')
  const ip = clientIp(req)
  // сервер слушает все интерфейсы, но пускает только из локальной сети
  if (!isLocalNetwork(ip)) return send(res, 403, 'Только из локальной сети')
  const url = new URL(req.url ?? '/', 'http://remote')
  // команды — только с заголовком и JSON: браузер не пошлёт такой запрос с чужой страницы без preflight
  const given = req.method === 'POST' ? req.headers['x-remote-token'] : (req.headers['x-remote-token'] ?? url.searchParams.get('t'))
  if (url.pathname !== '/' && !url.pathname.startsWith('/api/')) return send(res, 404, 'Not found')
  if (!tokenMatches(token, url.pathname === '/' ? url.searchParams.get('t') : given)) {
    return send(res, 401, url.pathname === '/' ? 'Ссылка устарела — отсканируйте QR-код заново' : 'Unauthorized')
  }
  if (pairedIp === null) {
    pairedIp = ip
    deps?.onStatus(info())
  } else if (pairedIp !== ip) {
    return send(res, 403, 'Пульт уже открыт на другом устройстве. На компьютере нажмите «Новый код».')
  }
  lastActivity = Date.now()

  // страницу отдаём только по ссылке с токеном; сам токен страница берёт из адреса
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, PAGE_HEADERS)
    return void res.end(page)
  }

  // проверка связи: телефон узнаёт, жив ли токен и его ли это пульт
  if (req.method === 'GET' && url.pathname === '/api/ping') return send(res, 204)

  if (req.method === 'GET' && url.pathname === '/api/events') {
    if (clients.size >= MAX_CLIENTS) return send(res, 503, 'Слишком много подключений')
    res.writeHead(200, { ...API_HEADERS, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' })
    res.write('retry: 2000\n\n')
    clients.add(res)
    if (latest) res.write(`data: ${JSON.stringify(latest.state)}\n\n`)
    const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS)
    req.on('close', () => {
      clearInterval(beat)
      clients.delete(res)
      deps?.onStatus(info())
    })
    deps?.onStatus(info())
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/command') {
    if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, 'JSON only')
    if (!takeCommandToken()) return send(res, 429, 'Слишком часто')
    let raw: unknown
    try {
      raw = JSON.parse(await readBody(req))
    } catch (e) {
      // ответ — до закрытия соединения, иначе клиент увидит обрыв вместо 413
      if (e instanceof BodyTooLarge) {
        res.setHeader('Connection', 'close')
        return send(res, 413, 'Слишком большой запрос')
      }
      return send(res, 400, 'Bad request')
    }
    const cmd = parseRemoteCommand(raw)
    if (!cmd) return send(res, 400, 'Unknown command')
    deps?.onCommand(cmd)
    return send(res, 204)
  }

  if (req.method === 'GET' && url.pathname === '/api/frame') {
    const frame = latest?.frame
    if (!latest?.state.ready || !frame || !deps?.isAllowedMedia(frame.videoPath)) return send(res, 409, 'Нет видео')
    const key = `${frame.videoPath}|${frame.time.toFixed(4)}`
    // один ffmpeg за раз: запросы того же кадра ждут его, новый кадр прерывает снятие старого
    if (frameCache?.key !== key) {
      frameCache?.child.kill('SIGKILL')
      const entry = { key, frameKey: latest.state.frameKey, ...extractFrame(frame.videoPath, frame.time) }
      entry.jpeg.catch(() => frameCache === entry && (frameCache = null))
      frameCache = entry
    }
    const entry = frameCache
    try {
      const jpeg = await entry.jpeg
      // телефон рисует поверх именно этого кадра и отправляет его ключ вместе с фигурой
      res.writeHead(200, { ...API_HEADERS, 'Content-Type': 'image/jpeg', 'Content-Length': jpeg.length, 'X-Frame-Key': encodeURIComponent(entry.frameKey) })
      return void res.end(jpeg)
    } catch {
      return send(res, 500, 'Не удалось снять кадр')
    }
  }
  return send(res, 404, 'Not found')
}

export async function startRemote(d: RemoteDeps): Promise<RemoteInfo> {
  deps = d
  if (server) return info()
  // новый токен на каждое включение: старые QR-коды и открытые вкладки перестают работать
  token = randomBytes(16).toString('base64url')
  const s = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, 'Error')
      else res.end()
    })
  })
  s.headersTimeout = 10000
  s.requestTimeout = 30000
  s.maxConnections = 64
  await new Promise<void>((resolve, reject) => {
    s.once('error', reject)
    // все интерфейсы: телефон может прийти через Wi-Fi или точку доступа ноутбука; доступ — из локальной сети и с токеном
    s.listen(0, '0.0.0.0', () => resolve())
  })
  // ошибки соединений после запуска не должны ронять main
  s.on('error', (e) => console.error('Пульт:', e))
  server = s
  pairedIp = null
  lastActivity = Date.now()
  bucket = { tokens: COMMANDS_PER_SECOND, at: Date.now() }
  stateTimer = setInterval(() => {
    pushState()
    if (clients.size === 0 && Date.now() - lastActivity > IDLE_STOP_MS) {
      stopRemote()
      d.onStatus(info())
    }
  }, STATE_INTERVAL_MS)
  return info()
}

export function stopRemote(): void {
  if (stateTimer) clearInterval(stateTimer)
  stateTimer = null
  for (const res of clients) res.end()
  clients.clear()
  server?.close()
  server?.closeAllConnections()
  server = null
  token = ''
  sentJson = ''
  frameCache?.child.kill('SIGKILL')
  frameCache = null
  pairedIp = null
  latest = null
}

/** Снимок от рендерера: форму проверяем, путь к видео приводим к абсолютному (allowedMedia хранит такие). */
export function publishRemote(payload: unknown): void {
  const p = payload as RemotePublish | null
  if (!p || typeof p !== 'object' || typeof p.state !== 'object' || p.state === null) return
  const f = p.frame
  const frame =
    f && typeof f.videoPath === 'string' && Number.isFinite(f.time) && f.time >= 0 && f.time < 1e6 ? { videoPath: resolve(f.videoPath), time: f.time } : null
  latest = { state: p.state, frame }
}

/** Порт и токен работающего сервера — для тестов (адрес в сети может отсутствовать). */
export function remoteEndpoint(): { port: number; token: string } | null {
  const port = server?.address()
  return port && typeof port !== 'string' ? { port: port.port, token } : null
}
