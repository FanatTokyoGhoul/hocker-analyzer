import { app } from 'electron'
import { rmSync } from 'fs'
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type { Project } from '../shared/types'
import { parseProject, serializeProject } from '../shared/project'

/** Черновик несохранённой работы: пишется рендерером через несколько секунд после правки. */
export type RecoveryFile = { savedAt: number; projectPath: string | null; project: Project }

export function recoveryPath(): string {
  return join(app.getPath('userData'), 'recovery.json')
}

let writing: Promise<void> = Promise.resolve()
/** Пользователь вышел без сохранения: запоздалые записи из рендерера не должны вернуть черновик. */
let discarded = false

/** Записи строго по очереди и атомарно; null — удалить черновик. */
export function writeRecovery(data: RecoveryFile | null): Promise<void> {
  writing = writing
    .then(async () => {
      const path = recoveryPath()
      if (!data || discarded) return rm(path, { force: true })
      await mkdir(dirname(path), { recursive: true })
      const body = JSON.stringify({ savedAt: data.savedAt, projectPath: data.projectPath, project: JSON.parse(serializeProject(data.project)) })
      await writeFile(`${path}.tmp`, body, 'utf8')
      await rename(`${path}.tmp`, path)
      // отказ мог случиться, пока шла запись
      if (discarded) await rm(path, { force: true })
    })
    .catch((e) => console.error('Не удалось записать черновик:', e))
  return writing
}

/** Синхронно — при выходе без сохранения, когда окно уже закрывается. Дальнейшие записи игнорируются. */
export function clearRecoverySync(): void {
  discarded = true
  try {
    rmSync(recoveryPath(), { force: true })
  } catch (e) {
    console.error('Не удалось удалить черновик:', e)
  }
}

export async function readRecovery(): Promise<RecoveryFile | null> {
  await writing
  try {
    const raw = JSON.parse(await readFile(recoveryPath(), 'utf8')) as Record<string, unknown>
    return {
      savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : 0,
      projectPath: typeof raw.projectPath === 'string' ? raw.projectPath : null,
      project: parseProject(raw.project)
    }
  } catch {
    return null
  }
}
