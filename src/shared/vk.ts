/** Сайты VK, с которых можно скачать видео по ссылке. */
const VK_HOSTS = new Set(['vk.com', 'vk.ru', 'vkvideo.ru'])
const VK_PREFIXES = ['', 'www.', 'm.', 'new.', 'vksport.']

/** Видео в адресе: /video-123_456, /clip-123_456, ?z=video-123_456, video_ext.php?oid=…&id=… */
const VIDEO_ID = /(?:video|clip)-?\d+_\d+/
const EMBED = /^\/video_ext\.php$/

function isVkHost(host: string): boolean {
  const h = host.toLowerCase()
  return VK_PREFIXES.some((p) => h.startsWith(p) && VK_HOSTS.has(h.slice(p.length)))
}

/**
 * Ссылка на видео VK или VK Видео → нормальный https-адрес; null — не ссылка на видео VK.
 * Принимает адрес без схемы («vk.com/video-1_2») и с пробелами вокруг (скопировали из сообщения).
 */
export function normalizeVkUrl(input: string): string | null {
  const text = input.trim()
  if (!text || text.length > 2000 || /\s/.test(text)) return null
  let url: URL
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password || url.port) return null
  if (!isVkHost(url.hostname)) return null
  // id видео — в пути (/video-1_2) или в параметре z (окно видео поверх ленты: ?z=video-1_2/pl_…);
  // в остальных параметрах не ищем: vk.com/away.php?to=…&v=video1_2 — переадресация на чужой сайт
  let path = url.pathname
  try {
    path = decodeURIComponent(path)
  } catch {
    // битая %-последовательность — проверяем как есть
  }
  const z = url.searchParams.get('z') ?? ''
  const embed = EMBED.test(url.pathname) && url.searchParams.has('oid') && url.searchParams.has('id')
  if (!VIDEO_ID.test(path) && !VIDEO_ID.test(z) && !embed) return null
  url.protocol = 'https:'
  url.hash = ''
  return url.toString()
}

/** Ход скачивания: этап и доля (null — размер неизвестен, показываем «бегущую» полосу). */
export type DownloadPhase = 'tool' | 'info' | 'video' | 'audio' | 'merge'

export type DownloadProgress = {
  phase: DownloadPhase
  ratio: number | null
  /** Байты: скачано и всего (всего — оценка, если сайт не сообщил точный размер). */
  downloaded: number
  total: number | null
  /** Байт/с и секунды до конца — если известны. */
  speed: number | null
  eta: number | null
  title: string | null
}
