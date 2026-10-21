# `src/shared/types.ts` — общие типы

**Назначение:** типы, общие для main, preload и renderer: модель проекта, рисунки, экспорт и контракт `window.api` (`HockeyApi`).

## Фигуры (`Shape`)

Размеченное объединение по полю `kind`. **Все координаты нормированы 0..1** относительно кадра (или схемы площадки), поэтому рисунки не зависят от размера окна.

| `kind` | Тип | Поля | Заметка |
|---|---|---|---|
| `arrow`, `line` | `LineShape` | `points: [x1, y1, x2, y2]`, `dashed?` | `dashed` — пунктир, обычно пас |
| `circle` | `CircleShape` | `x, y, rx, ry` | Радиусы по осям, чтобы круг оставался кругом |
| `spotlight` | `SpotlightShape` | как `circle` | Подсветка игрока: всё вокруг затемняется |
| `freehand` | `FreehandShape` | `points: [x, y, …]` | От руки |
| `zone` | `ZoneShape` | `points: [x, y, …]` | Замкнутый многоугольник, не меньше трёх вершин |
| `text` | `TextShape` | `x, y` (левый верхний угол), `text` | До 200 символов |

Все фигуры имеют `id` и `color`.

## Проект

```ts
type Project = {
  version?: number          // 2 для текущего формата
  videoPath: string         // путь первого видео, для совместимости с v1
  fps: number               // fps первого видео, для совместимости с v1
  videos: ProjectVideo[]
  moments: Moment[]
  periods?: number[]        // начала 2-го, 3-го … периодов, время проекта
}

type ProjectVideo = {
  id: string; path: string; label: string
  offset: number            // с какой секунды проекта начинается видео
  fps: number
  duration?: number         // запоминается при открытии
}

type Moment = {
  id: string; title: string
  start: number; end: number          // время проекта, start <= end
  tags?: string[]
  drawings?: Drawing[]
  notes?: string                      // заметка
  board?: Shape[]                     // схема площадки, координаты к 200×85
}

type Drawing = { time: number; shapes: Shape[]; videoId?: string }
```

- **Время.** `start`, `end`, `Drawing.time` — время проекта. Локальное время видео равно времени проекта минус `offset`.
- **`Drawing.time`** — середина кадра: `(frameIndex + 0.5) / fps` плюс `offset`.
- **`videoId`** отсутствует у рисунков первого видео (так их понимают проекты v1).

## Открытие и восстановление

| Тип | Описание |
|---|---|
| `VideoInfo` | Результат ffprobe плюс `path`, `url` (`media://…`), `needsConversion`, `variableFrameRate` |
| `OpenedProject` | `{ path, project, missingVideos }` — id видео, которые не найдены |
| `Recovery` | `{ savedAt, projectPath, project, missingVideos }` — черновик из [recovery.ts](../main/recovery.ts.md) |
| `ConvertProgress` | `{ ratio: 0..1, outTime }` |
| `LoadedSettings` | `{ settings, path }` — ответ `loadSettings` |

## Экспорт

| Тип | Описание |
|---|---|
| `ExportOverlay` | `{ time, png }` — рисунок в локальном времени видео |
| `ExportClip` | Отрезок `start`–`end` (локальное время), видео, размер кадра, `overlays`, необязательные `captionPng` и `boardPng` |
| `ExportRequest` | `clips`, `mode: 'single' \| 'separate'`, `holdSeconds`, выходные `width`, `height`, `fps`, `suggestedName` |
| `ExportProgress` | `{ ratio, clip, clips }` |
| `ExportResult` | `{ paths }` |

Проверка запроса — [export.ts](../main/export.ts.md).

## `HockeyApi`

Интерфейс `window.api`, реализуется в [preload](../preload/index.ts.md). Новое в v0.3: `addVideoDialog`, `writeRecovery`, `readRecovery`, `exportClips`, `cancelExport`, `onExportProgress`, `saveTextFile`, `revealFile`.

Формат JSON на диске — `Project`. Проверку при чтении делает [project.ts](project.ts.md).
