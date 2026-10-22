import type { ConvertProgress, ProjectVideo, Recovery, VideoInfo } from '../../../shared/types'
import { fileName } from '../lib/paths'
import { Btn } from './Btn'

type Props = {
  recovery: Recovery | null
  onRestore(): void
  onDiscard(): void
  converting: ConvertProgress | null
  missingVideo: ProjectVideo | null
  onRelocate(id: string): void
  info: VideoInfo | null
  playbackError: boolean
  vfrDismissed: boolean
  onConvert(): void
  onDismissVfr(): void
}

/** Плашка внизу видео — самое важное из: черновик, конвертация, ненайденное видео, неподдерживаемый формат, VFR. */
export function StageBanner(p: Props): React.JSX.Element | null {
  if (p.recovery) {
    const r = p.recovery
    return (
      <div className="banner banner-warn" role="alert">
        <span>
          Найдена несохранённая работа: {fileName(r.projectPath ?? r.project.videoPath)}, {new Date(r.savedAt).toLocaleString('ru')} · моментов:{' '}
          {r.project.moments.length}
        </span>
        <Btn variant="primary" onClick={p.onRestore}>
          Восстановить
        </Btn>
        <Btn onClick={p.onDiscard}>Удалить</Btn>
      </div>
    )
  }
  if (p.converting) {
    return (
      <div className="banner">
        <span>Конвертация в H.264… {Math.round(p.converting.ratio * 100)}%</span>
        <div className="progress">
          <div style={{ width: `${p.converting.ratio * 100}%` }} />
        </div>
        <Btn onClick={() => window.api.cancelConvert()}>Отмена</Btn>
      </div>
    )
  }
  if (p.missingVideo) {
    const v = p.missingVideo
    return (
      <div className="banner banner-warn">
        <span>
          Видео «{v.label}» не найдено: {v.path}
        </span>
        <Btn variant="primary" onClick={() => p.onRelocate(v.id)}>
          Указать видео
        </Btn>
      </div>
    )
  }
  const info = p.info
  if (info && (info.needsConversion || p.playbackError)) {
    return (
      <div className="banner banner-warn">
        <span>
          {info.needsConversion ? `Не воспроизвести: ${info.conversionReason}.` : 'Встроенный плеер не смог воспроизвести файл.'} Конвертировать в
          H.264 (рядом с исходником)?
        </span>
        <Btn variant="primary" onClick={p.onConvert}>
          Конвертировать
        </Btn>
      </div>
    )
  }
  if (info?.variableFrameRate && !p.vfrDismissed) {
    return (
      <div className="banner banner-warn">
        <span>
          Переменная частота кадров (типично для телефонов): покадровый шаг может пропускать кадры. Конвертировать в постоянные{' '}
          {Math.round(info.fps)} fps?
        </span>
        <Btn variant="primary" onClick={p.onConvert}>
          Конвертировать
        </Btn>
        <Btn onClick={p.onDismissVfr}>Скрыть</Btn>
      </div>
    )
  }
  return null
}
