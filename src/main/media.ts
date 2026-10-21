import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { extname } from 'path'
import { Readable } from 'stream'

export const MEDIA_SCHEME = 'media'

export function toMediaUrl(filePath: string): string {
  return `${MEDIA_SCHEME}://local/${encodeURIComponent(filePath)}`
}

export function fromMediaUrl(url: string): string {
  const { pathname } = new URL(url)
  return decodeURIComponent(pathname.replace(/^\//, ''))
}

export type ByteRange = { start: number; end: number }

/** Разбирает заголовок Range (один диапазон). null — заголовок некорректен или вне файла. */
export function parseRange(header: string, size: number): ByteRange | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '') || size === 0) return null
  let start: number
  let end: number
  if (m[1] === '') {
    // bytes=-N — последние N байт
    start = Math.max(0, size - Number(m[2]))
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  if (start >= size || start > end) return null
  return { start, end }
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/mp4', // Chromium надёжнее играет QuickTime, отданный как mp4
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.ts': 'video/mp2t',
  '.mts': 'video/mp2t'
}

/** Отдаёт локальный файл с поддержкой Range — без этого <video> не умеет перематывать. */
export async function serveFile(filePath: string, rangeHeader: string | null): Promise<Response> {
  const { size } = await stat(filePath)
  const headers: Record<string, string> = {
    'Accept-Ranges': 'bytes',
    'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  }
  if (rangeHeader) {
    const range = parseRange(rangeHeader, size)
    if (!range) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    const body = Readable.toWeb(createReadStream(filePath, range)) as ReadableStream
    return new Response(body, {
      status: 206,
      headers: {
        ...headers,
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
        'Content-Length': String(range.end - range.start + 1)
      }
    })
  }
  const body = Readable.toWeb(createReadStream(filePath)) as ReadableStream
  return new Response(body, { status: 200, headers: { ...headers, 'Content-Length': String(size) } })
}
