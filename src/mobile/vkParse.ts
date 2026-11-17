/**
 * Разбор ответа VK для скачивания на телефоне (чистые функции, без сети — сеть делает нативный плагин).
 * Телефон не может запустить yt-dlp, поэтому повторяем его путь: POST al_video.php act=show&al=1
 * с десктопным User-Agent и Referer https://vk.com/al_video.php (VK по мобильному UA отдаёт страницу
 * без параметров плеера). Ответ — JSON: payload[1][-1] содержит mvData (название) и player.params[0]
 * со ссылками url144…url720 (прогрессивный mp4) и hls_fmp4 (HLS сегментами fMP4).
 */

/** Идентификатор видео «oid_id» из нормальной ссылки VK (shared/vk.normalizeVkUrl). */
const VIDEO_ID = /(?:video|clip)(-?\d+)_(\d+)/
const VK_HOST = /(^|\.)(vk\.com|vk\.ru|vkvideo\.ru)$/i

export function vkVideoId(url: string): string | null {
  try {
    const u = new URL(url)
    if (!VK_HOST.test(u.hostname)) return null
    let path = u.pathname
    try {
      path = decodeURIComponent(path)
    } catch {
      // битая %-последовательность — проверяем как есть
    }
    // id только в пути или в z (окно видео над лентой): away.php?to=…video1_2 — переадресация, не берём
    const inPath = VIDEO_ID.exec(path)
    if (inPath) return `${inPath[1]}_${inPath[2]}`
    if (/^\/video_ext\.php$/i.test(u.pathname)) {
      const oid = u.searchParams.get('oid')
      const id = u.searchParams.get('id')
      if (oid && id && /^-?\d+$/.test(oid) && /^\d+$/.test(id)) return `${oid}_${id}`
    }
    const z = (u.searchParams.get('z') ?? '').split('/')[0]
    const inZ = VIDEO_ID.exec(z)
    if (inZ) return `${inZ[1]}_${inZ[2]}`
  } catch {
    // не URL
  }
  return null
}

export type VkStream = { url: string; quality: number; kind: 'mp4' | 'hls' }

export type VkPlayerInfo = { title: string | null; duration: number | null; streams: VkStream[] }

/** Ошибка ответа VK с готовым для пользователя текстом (приватное видео, удалено, региональный блок). */
export class VkError extends Error {}

const streamUrl = (url: unknown): string | null => (typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null)

/** url720/hls_fmp4/… → качество из ключа. */
function qualityFromKey(key: string): number {
  const m = /(?:url|mp4|hls_fmp4|hls_?|dash_?)(\d{2,4})$/.exec(key)
  return m ? Number(m[1]) : key === 'hls_fmp4' || key === 'hls' ? 720 : 0
}

/**
 * Ответ `al_video.php?act=show`: возвращает название, длительность и все потоки.
 * Бросает VkError с русским текстом, если VK ответил кодом ошибки.
 */
export function parseVkShow(jsonText: string): VkPlayerInfo {
  let root: unknown
  try {
    root = JSON.parse(jsonText)
  } catch {
    throw new VkError('VK ответил непонятно — попробуйте ещё раз')
  }
  const payload = (root as { payload?: unknown })?.payload
  if (!Array.isArray(payload)) throw new VkError('VK не прислал сведений о видео')
  const code = String(payload[0])
  if (code === '3') throw new VkError('Это видео доступно только после входа в VK')
  if (code === '8') {
    const msg = Array.isArray(payload[1]) && typeof payload[1][0] === 'string' ? payload[1][0].replace(/^"|"$/g, '') : null
    throw new VkError(msg ? `VK: ${msg}` : 'VK отказал в доступе к видео')
  }
  const inner = Array.isArray(payload[1]) ? payload[1] : []
  const opts = inner.length ? inner[inner.length - 1] : null
  const record = opts && typeof opts === 'object' ? (opts as Record<string, unknown>) : {}
  const mv = (record.mvData ?? {}) as Record<string, unknown>
  const player = (record.player ?? {}) as Record<string, unknown>
  const params: unknown = Array.isArray(player.params) ? player.params[0] : undefined
  const mdTitle = params && typeof params === 'object' ? (params as { md_title?: unknown }).md_title : undefined
  const title = (typeof mv.title === 'string' && mv.title.trim()) || (typeof mdTitle === 'string' && mdTitle) || null
  const duration = typeof mv.duration === 'number' && mv.duration > 0 ? mv.duration : null
  const streams: VkStream[] = []
  const seen = new Set<string>()
  const add = (key: string, url: string | null) => {
    if (!url || seen.has(url)) return
    seen.add(url)
    streams.push({ url, quality: qualityFromKey(key), kind: /\.m3u8([?#]|$)/i.test(url) || key.startsWith('hls') ? 'hls' : 'mp4' })
  }
  if (params && typeof params === 'object') {
    for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
      if (/^(url\d+|mp4\d+|hls_fmp4|hls\d*)$/i.test(key)) add(key, streamUrl(value))
    }
  }
  return { title, duration, streams }
}

/** Лучший поток: самый качественный прогрессивный mp4, иначе HLS. */
export function pickVkStream(streams: VkStream[]): VkStream | null {
  if (!streams.length) return null
  const mp4 = streams.filter((s) => s.kind === 'mp4').sort((a, b) => b.quality - a.quality)
  if (mp4.length) return mp4[0]
  return streams.sort((a, b) => b.quality - a.quality)[0]
}

/** Имя файла для скачанного видео: без запрещённых символов, не длинно. */
export function vkFileName(title: string | null): string {
  const base = (title ?? 'Видео VK')
    .replace(/[\u0000-\u001f/:*?"<>|\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(^\s*\.)+|\.+(\s*$)/g, '$1')
    .replace(/\s*\.\s*/g, ' ')
    .trim()
    .slice(0, 100)
    .trim()
  return `${base || 'Видео VK'}.mp4`
}
