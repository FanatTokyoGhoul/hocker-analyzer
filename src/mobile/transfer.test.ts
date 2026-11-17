import { describe, expect, it } from 'vitest'
import type { Project } from '../shared/types'
import { parseProject, serializeProject } from '../shared/project'
import { fileNameOf, projectFileName, projectForFile, projectFromFile } from './transfer'

const uri1 = 'content://com.android.providers.media.documents/document/video%3A1001'
const uri2 = 'content://com.android.providers.media.documents/document/video%3A1002'
const names: Record<string, string> = { [uri1]: 'VID_20261018_1900.mp4', [uri2]: 'period2.mp4' }
const nameOf = (p: string): string => names[p] ?? fileNameOf(p)

const project: Project = {
  version: 2,
  videoPath: uri1,
  fps: 30,
  videos: [
    { id: 'v1', path: uri1, label: 'Видео 1', offset: 0, fps: 30, duration: 1200 },
    { id: 'v2', path: uri2, label: 'Период 2', offset: 1200, fps: 30 }
  ],
  moments: [{ id: 'm1', title: 'Гол', start: 10, end: 20, tags: ['гол'], drawings: [{ time: 12, videoId: 'v2', shapes: [{ id: 's1', kind: 'circle', x: 0.5, y: 0.5, rx: 0.1, ry: 0.1, color: '#ff3b30' }] }] }]
}

describe('projectForFile', () => {
  it('replaces content URIs with file names so the PC finds videos next to the project', () => {
    const out = projectForFile(project, nameOf)
    expect(out.videos.map((v) => v.path)).toEqual(['VID_20261018_1900.mp4', 'period2.mp4'])
    expect(out.videoPath).toBe('VID_20261018_1900.mp4')
    expect(out.moments).toBe(project.moments)
  })

  it('keeps PC paths that were never relinked on the phone', () => {
    const p = { ...project, videos: [{ ...project.videos[0], path: 'C:\\Матчи\\игра.mp4' }] }
    expect(projectForFile(p, nameOf).videos[0].path).toBe('C:\\Матчи\\игра.mp4')
  })

  it('survives the desktop parser round trip', () => {
    const parsed = parseProject(JSON.parse(serializeProject(projectForFile(project, nameOf))))
    expect(parsed.videos.map((v) => v.path)).toEqual(['VID_20261018_1900.mp4', 'period2.mp4'])
    expect(parsed.moments[0].drawings?.[0].videoId).toBe('v2')
  })
})

describe('projectFromFile', () => {
  it('maps names and PC paths to known content URIs', () => {
    const file: Project = {
      ...project,
      videos: [
        { ...project.videos[0], path: 'D:/Хоккей/VID_20261018_1900.mp4' },
        { ...project.videos[1], path: 'period2.mp4' }
      ]
    }
    const out = projectFromFile(file, { 'VID_20261018_1900.mp4': uri1, 'period2.mp4': uri2 })
    expect(out.videos.map((v) => v.path)).toEqual([uri1, uri2])
    expect(out.videoPath).toBe(uri1)
  })

  it('does not trust content URIs coming from a file', () => {
    const file: Project = { ...project, videos: [{ ...project.videos[0], path: 'content://evil.provider/secret' }] }
    expect(projectFromFile(file, {}).videos[0].path).toBe('secret')
  })

  it('leaves unknown videos for the user to point at', () => {
    const file: Project = { ...project, videos: [{ ...project.videos[0], path: '/home/coach/game.mp4' }] }
    expect(projectFromFile(file, {}).videos[0].path).toBe('/home/coach/game.mp4')
  })
})

describe('projectFileName', () => {
  it('is named after the first video', () => {
    expect(projectFileName(project, nameOf)).toBe('VID_20261018_1900.hockey.json')
  })
})
