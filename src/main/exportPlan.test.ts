import { describe, expect, it } from 'vitest'
import type { ExportClip } from '../shared/types'
import {
  buildClipJob,
  buildConcatArgs,
  buildConcatList,
  clipFileName,
  expectedClipDuration,
  planPieces,
  sanitizeFileName
} from './exportPlan'

const clip = (over: Partial<ExportClip> = {}): ExportClip => ({
  title: 'Гол',
  videoPath: '/v/match.mp4',
  start: 10,
  end: 20,
  width: 1920,
  height: 1080,
  fps: 25,
  overlays: [],
  ...over
})
const params = { width: 1280, height: 720, fps: 30, holdSeconds: 3 }
const job = (c: ExportClip, extra: Record<string, unknown> = {}) =>
  buildClipJob({
    clip: c,
    params,
    hasAudio: true,
    overlayPaths: c.overlays.map((_, i) => `/t/o${i}.png`),
    scriptPath: '/t/f.txt',
    outputPath: '/t/out.mp4',
    ...extra
  })

describe('planPieces', () => {
  it('без рисунков — один кусок до конца', () => {
    expect(planPieces(clip(), 3)).toEqual([{ kind: 'play', from: 0, to: null }])
  })

  it('один рисунок делит клип на воспроизведение, стоп-кадр и продолжение', () => {
    const p = planPieces(clip({ overlays: [{ time: 14, png: 'x' }] }), 3)
    expect(p.map((x) => x.kind)).toEqual(['play', 'freeze', 'play'])
    expect(p[1]).toMatchObject({ kind: 'freeze', overlay: 0 })
    expect((p[1] as { at: number }).at).toBeCloseTo(4 - 0.02, 5)
    expect(p[2]).toMatchObject({ from: (p[1] as { at: number }).at, to: null })
  })

  it('два рисунка сортируются по времени, индекс сохраняется', () => {
    const p = planPieces(clip({ overlays: [{ time: 18, png: 'a' }, { time: 12, png: 'b' }] }), 2)
    expect(p.filter((x) => x.kind === 'freeze').map((x) => (x as { overlay: number }).overlay)).toEqual([1, 0])
    expect(p.map((x) => x.kind)).toEqual(['play', 'freeze', 'play', 'freeze', 'play'])
  })

  it('рисунки вне клипа игнорируются, на границах — зажимаются', () => {
    const p = planPieces(clip({ overlays: [{ time: 5, png: 'a' }, { time: 25, png: 'b' }, { time: 10, png: 'c' }] }), 3)
    const f = p.filter((x) => x.kind === 'freeze')
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ overlay: 2, at: 0 })
    expect(p[0].kind).toBe('freeze') // пустого куска перед ним нет
  })

  it('при holdSeconds = 0 стоп-кадров нет', () => {
    expect(planPieces(clip({ overlays: [{ time: 14, png: 'x' }] }), 0)).toHaveLength(1)
  })
})

describe('длительность', () => {
  it('клип + стоп-кадры * hold + схема', () => {
    expect(expectedClipDuration(clip(), 3)).toBe(10)
    expect(expectedClipDuration(clip({ overlays: [{ time: 12, png: 'a' }, { time: 15, png: 'b' }, { time: 99, png: 'c' }] }), 2)).toBe(14)
    expect(expectedClipDuration(clip({ boardPng: 'b', overlays: [{ time: 12, png: 'a' }] }), 2)).toBe(14)
  })
})

describe('buildClipJob', () => {
  it('аргументы: поиск до -i, whitelist, скрипт фильтра, кодеки', () => {
    const { args } = job(clip())
    expect(args.slice(0, 5)).toEqual(['-y', '-ss', '10', '-t', '10'])
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
    expect(args).toContain('-format_whitelist')
    expect(args[args.indexOf('-filter_complex_script') + 1]).toBe('/t/f.txt')
    expect(args).toEqual(expect.arrayContaining(['libx264', 'veryfast', '20', 'yuv420p', 'aac', '160k', '+faststart']))
    expect(args[args.length - 1]).toBe('/t/out.mp4')
  })

  it('с аудио: aresample, без aevalsrc', () => {
    const { filterScript } = job(clip())
    expect(filterScript).toContain('[0:a]aresample')
    expect(filterScript).not.toContain('aevalsrc')
    expect(filterScript).toContain('scale=1280:720:force_original_aspect_ratio=decrease')
    expect(filterScript).toContain('concat=n=1:v=1:a=1[vout][aout]')
  })

  it('без аудио: вся дорожка — aevalsrc', () => {
    const { filterScript } = job(clip({ overlays: [{ time: 14, png: 'a' }] }), { hasAudio: false })
    expect(filterScript).not.toContain('[0:a]')
    expect(filterScript.match(/aevalsrc/g)).toHaveLength(3)
  })

  it('рисунок: оверлей на нативном кадре до масштабирования, второй PNG-вход', () => {
    const { filterScript, args } = job(clip({ overlays: [{ time: 14, png: 'a' }] }))
    expect(filterScript).toContain('[1:v]overlay')
    expect(filterScript).toMatch(/overlay=format=auto[^;]*\[o1\];\n\[o1\]scale=/)
    expect(args.filter((x) => x === '-i')).toHaveLength(2)
  })

  it('подпись — только первые 3 с; со схемой окно сдвигается на hold', () => {
    const a = job(clip(), { captionPath: '/t/cap.png' })
    expect(a.filterScript).toContain("enable='between(t,0,3)'")
    const b = job(clip({ boardPng: 'x' }), { captionPath: '/t/cap.png', boardPath: '/t/b.png' })
    expect(b.filterScript).toContain("enable='between(t,3,6)'")
    expect(b.filterScript).toContain('[1:v]') // схема
    expect(b.filterScript).toContain('[2:v]') // подпись
    expect(b.duration).toBe(13)
  })

  it('без подписи и схемы лишних входов нет', () => {
    const { filterScript, args } = job(clip())
    expect(filterScript).not.toContain('enable=')
    expect(args.filter((x) => x === '-i')).toHaveLength(1)
  })
})

describe('имена файлов', () => {
  it('убирает недопустимые символы и ограничивает длину', () => {
    expect(sanitizeFileName('a/b:c*d?"e<f>g|h\\i')).toBe('a_b_c_d__e_f_g_h_i')
    expect(sanitizeFileName('  Гол   в  ворота. ')).toBe('Гол в ворота')
    expect(sanitizeFileName('')).toBe('Клип')
    expect(sanitizeFileName('...')).toBe('Клип')
    expect(sanitizeFileName('CON')).toBe('_CON')
    expect(sanitizeFileName('x'.repeat(200))).toHaveLength(80)
  })

  it('нумерует клипы', () => {
    expect(clipFileName(0, 5, 'Гол')).toBe('01 Гол.mp4')
    expect(clipFileName(11, 120, 'a')).toBe('012 a.mp4')
  })
})

describe('concat', () => {
  it('экранирует одинарные кавычки', () => {
    expect(buildConcatList(["/t/a.mp4", "/t/it's.mp4"])).toBe("file '/t/a.mp4'\nfile '/t/it'\\''s.mp4'\n")
  })

  it('копирует потоки без перекодирования', () => {
    const args = buildConcatArgs('/t/l.txt', '/o.mp4')
    expect(args).toEqual(expect.arrayContaining(['-f', 'concat', '-safe', '0', '-c', 'copy', 'file,concat']))
  })
})
